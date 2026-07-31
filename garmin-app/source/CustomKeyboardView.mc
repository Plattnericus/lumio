import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

// TextPicker (the only text-entry widget Connect IQ actually ships) is a
// legacy spinner control built for button-only devices - on a touchscreen
// like the Vivoactive 6 it looks and behaves like nothing else in the app
// and is genuinely confusing to use. There is no native on-screen
// keyboard class in Toybox.WatchUi (confirmed against the official API
// docs), so this draws a real tap-to-type keyboard by hand instead,
// matching how third-party full-keyboard apps on this platform do it.
class CustomKeyboardView extends WatchUi.View {
    private var _prompt as String;
    private var _buffer as String;
    private var _keys as Array<String>;
    private var _cols as Number;
    private var _switchLabel as String?;
    private var _keyRects as Array<[Number, Number, Number, Number]>; // [x, y, w, h] per key, index-matched to _keys + the optional switch key + the two action keys appended at the end

    private const BACKSPACE = "⌫";
    private const CONFIRM = "✓";
    // vivoactive6 is 390x390 round (confirmed against Garmin's compatible-
    // devices reference and the SDK's own per-device compiler.json/
    // simulator.json) - past this many characters, FONT_SMALL at the
    // buffer's on-screen width would overrun the safe circular area, so
    // only the tail (the part nearest the typing cursor) is shown.
    private const MAX_VISIBLE_BUFFER_CHARS = 18;

    // switchLabel is the text for an optional extra key (e.g. "123" on a
    // letters page, "ABC" on a numbers/symbols page) that lets the caller
    // swap to a different character set without losing what's been typed
    // so far - pass null for a keyboard that only ever needs one page
    // (the pairing code's fixed alphabet, for example).
    function initialize(prompt as String, keys as Array<String>, cols as Number, switchLabel as String?) {
        View.initialize();
        _prompt = prompt;
        _buffer = "";
        _keys = keys;
        _cols = cols;
        _switchLabel = switchLabel;
        _keyRects = [] as Array<[Number, Number, Number, Number]>;
    }

    function setBuffer(text as String) as Void {
        _buffer = text;
        WatchUi.requestUpdate();
    }

    function getBuffer() as String {
        return _buffer;
    }

    function appendChar(c as String) as Void {
        _buffer += c;
        WatchUi.requestUpdate();
    }

    function backspace() as Void {
        if (_buffer.length() > 0) {
            _buffer = _buffer.substring(0, _buffer.length() - 1);
            WatchUi.requestUpdate();
        }
    }

    function setPrompt(text as String) as Void {
        _prompt = text;
        WatchUi.requestUpdate();
    }

    // All key characters plus the optional page-switch key and the two
    // fixed action keys (backspace, confirm), in the exact order they're
    // drawn/hit-tested.
    function allSlots() as Array<String> {
        var slots = [] as Array<String>;
        for (var i = 0; i < _keys.size(); i++) {
            slots.add(_keys[i]);
        }
        if (_switchLabel != null) {
            slots.add(_switchLabel as String);
        }
        slots.add(BACKSPACE);
        slots.add(CONFIRM);
        return slots;
    }

    function isBackspace(slot as String) as Boolean {
        return slot.equals(BACKSPACE);
    }

    function isConfirm(slot as String) as Boolean {
        return slot.equals(CONFIRM);
    }

    function isSwitch(slot as String) as Boolean {
        return _switchLabel != null && slot.equals(_switchLabel as String);
    }

    // Returns the tapped slot's character (or BACKSPACE/CONFIRM), or null
    // if the tap landed outside every key.
    function slotAt(x as Number, y as Number) as String? {
        var slots = allSlots();
        for (var i = 0; i < _keyRects.size() && i < slots.size(); i++) {
            var rect = _keyRects[i];
            if (x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]) {
                return slots[i];
            }
        }
        return null;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();

        dc.drawText(width / 2, height * 0.10, Graphics.FONT_XTINY, _prompt, Graphics.TEXT_JUSTIFY_CENTER);

        var shownBuffer = _buffer;
        if (shownBuffer.length() == 0) {
            shownBuffer = "_";
        } else if (shownBuffer.length() > MAX_VISIBLE_BUFFER_CHARS) {
            shownBuffer = "…" + shownBuffer.substring(shownBuffer.length() - MAX_VISIBLE_BUFFER_CHARS, shownBuffer.length());
        }
        dc.drawText(width / 2, height * 0.20, Graphics.FONT_SMALL, shownBuffer, Graphics.TEXT_JUSTIFY_CENTER);

        drawKeyboard(dc, width, height);
    }

    // A plain full-width rectangular grid puts the outer keys of the top
    // and bottom rows under the bezel (or entirely off the tappable area)
    // on a round face - confirmed for vivoactive6's 390x390 round display.
    // Each row is instead sized to the circle's actual chord width at that
    // row's vertical position, so every drawn key stays fully on-screen
    // and tappable; only non-round displays get the plain full-width row.
    private function drawKeyboard(dc as Graphics.Dc, width as Number, height as Number) as Void {
        var slots = allSlots();
        var rows = (slots.size() + _cols - 1) / _cols;

        // Keyboard occupies the lower ~72% of the screen - clear of the
        // prompt/buffer text above it.
        var top = height * 0.28;
        var usableHeight = height * 0.70;
        var keyH = usableHeight / rows;

        var isRound = System.getDeviceSettings().screenShape == System.SCREEN_SHAPE_ROUND;
        var centerX = width / 2.0;
        var centerY = height / 2.0;
        var radius = (width < height ? width : height) / 2.0;
        // A row whose center lands very near the top/bottom of the circle
        // still gets this minimum share of the full width - otherwise the
        // chord math alone would squeeze it down to an unusably thin sliver.
        var minHalfWidth = radius * 0.35;

        _keyRects = [] as Array<[Number, Number, Number, Number]>;

        for (var row = 0; row < rows; row++) {
            var rowTop = top + row * keyH;
            var rowCenterY = rowTop + keyH / 2;

            var rowWidth = width.toDouble();
            if (isRound) {
                var dy = (rowCenterY - centerY).abs();
                var halfWidth = dy < radius ? Math.sqrt(radius * radius - dy * dy) : minHalfWidth;
                if (halfWidth < minHalfWidth) {
                    halfWidth = minHalfWidth;
                }
                rowWidth = halfWidth * 2;
            }

            var rowLeft = centerX - rowWidth / 2;
            var keyW = rowWidth / _cols;

            for (var col = 0; col < _cols; col++) {
                var i = row * _cols + col;
                if (i >= slots.size()) {
                    break;
                }

                var x = rowLeft + col * keyW;
                var y = rowTop;

                _keyRects.add([x.toNumber(), y.toNumber(), keyW.toNumber(), keyH.toNumber()]);

                dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawRectangle(x.toNumber() + 1, y.toNumber() + 1, keyW.toNumber() - 2, keyH.toNumber() - 2);

                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(
                    (x + keyW / 2).toNumber(),
                    (y + keyH / 2).toNumber(),
                    Graphics.FONT_TINY,
                    slots[i],
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
                );
            }
        }
    }
}
