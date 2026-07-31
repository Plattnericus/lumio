import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.WatchUi;

// The code is typed directly on the watch, not configured ahead of time
// via Garmin Connect Mobile's app settings - it's short-lived and
// single-use, so entering it right where it's needed removes a whole
// round-trip through a phone app. Uses the hand-built keyboard, not
// TextPicker - restricted to the pairing code's own alphabet (matches
// pairingService.js's CODE_ALPHABET server-side: no 0/O/1/I, so a code
// read off a tiny screen is never ambiguous).
class PairingDelegate extends WatchUi.BehaviorDelegate {
    private var _view as PairingView;

    private const CODE_ALPHABET = [
        "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "M", "N",
        "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
        "2", "3", "4", "5", "6", "7", "8", "9",
    ];

    function initialize(view as PairingView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() as Boolean {
        var keyboardView = new CustomKeyboardView("Pairing code", CODE_ALPHABET as Array<String>, 8, null);
        var delegate = new CustomKeyboardDelegate(
            keyboardView,
            method(:onCodeEntered) as Method(text as String) as Void,
            method(:onNoOpSwitch) as Method(text as String) as Void
        );
        WatchUi.pushView(keyboardView, delegate, WatchUi.SLIDE_IMMEDIATE);
        return true;
    }

    function onNoOpSwitch(text as String) as Void {
        // Single-page keyboard - no switch key is ever shown, so this
        // should never actually run.
    }

    function onCodeEntered(text as String) as Void {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        var code = text.toUpper();
        _view.setStatus("Pairing...");
        LumioApi.exchangePairingCode(code, method(:onExchangeResponse) as Method(responseCode as Number, data as Dictionary?) as Void);
    }

    function onExchangeResponse(responseCode as Number, data as Dictionary?) as Void {
        if (responseCode == 200 && data != null && data.hasKey("token")) {
            Storage.setValue("deviceToken", data.get("token"));
            WatchUi.switchToView(new ImageListView(), new ImageListDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else {
            _view.setStatus("That code didn't work.\nCheck it and try again.");
        }
    }
}
