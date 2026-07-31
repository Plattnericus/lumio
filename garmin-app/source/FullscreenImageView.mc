import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

class FullscreenImageView extends WatchUi.View {
    private var _imageId as Number;
    private var _bitmap as Graphics.BitmapReference?;
    private var _loading as Boolean;
    private var _errorCode as Number?;
    // Guards against a stale callback (already handled by the timeout
    // below) and lets the timeout know whether it still needs to act -
    // see ImageListView's _awaitingList for the full reasoning.
    private var _awaitingImage as Boolean;
    private var _timeoutTimer as Timer.Timer?;
    private const LOAD_TIMEOUT_MS = 12000;

    // Zoom/pan state. Connect IQ has no pinch/multi-touch gesture API -
    // InputDelegate is single-touch-point only, even on a touch-first
    // device like the Vivoactive 6 - so drawScaledBitmap plus
    // tap-to-cycle-zoom/swipe-to-pan is the idiomatic substitute here,
    // not a workaround for a missing gesture.
    private var _zoomLevel as Number;
    private var _offsetX as Number;
    private var _offsetY as Number;

    private const MAX_ZOOM = 3;

    function initialize(imageId as Number) {
        View.initialize();
        _imageId = imageId;
        _loading = true;
        _zoomLevel = 1;
        _offsetX = 0;
        _offsetY = 0;
        _awaitingImage = false;
        _timeoutTimer = null;
    }

    function onShow() as Void {
        // Sized to this device's actual screen, not a fixed guess - a
        // screen bigger than some hardcoded size would upscale a
        // too-small image, and there's no reason to ask for more pixels
        // than the screen can show either.
        var settings = System.getDeviceSettings();
        _awaitingImage = true;
        LumioApi.fetchImage(
            _imageId,
            settings.screenWidth,
            settings.screenHeight,
            method(:onImageLoaded) as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void
        );

        _timeoutTimer = new Timer.Timer();
        (_timeoutTimer as Timer.Timer).start(method(:onImageTimeout) as Method() as Void, LOAD_TIMEOUT_MS, false);
    }

    // Doesn't force-cancel the fetch here (used to, via
    // Communications.cancelAllRequests() - see ImageListView.onHide's
    // comment for exactly why that turned out to be unreliable and was
    // removed everywhere). This view only ever has one request in
    // flight, so letting an abandoned one finish quietly in the
    // background - its result never looked at again once this view is
    // gone - is harmless.
    function onHide() as Void {
        _awaitingImage = false;
        if (_timeoutTimer != null) {
            (_timeoutTimer as Timer.Timer).stop();
            _timeoutTimer = null;
        }
    }

    function onImageTimeout() as Void {
        _timeoutTimer = null;
        if (!_awaitingImage) {
            return;
        }
        onImageLoaded(ConnectionError.CLIENT_TIMEOUT, null);
    }

    function onImageLoaded(responseCode as Number, data as Graphics.BitmapReference?) as Void {
        if (!_awaitingImage) {
            // Stale - already handled (timed out) or from a view that's
            // no longer showing. Ignore it entirely.
            return;
        }
        _awaitingImage = false;
        if (_timeoutTimer != null) {
            (_timeoutTimer as Timer.Timer).stop();
            _timeoutTimer = null;
        }

        _loading = false;
        if (responseCode == 200 && data != null) {
            _bitmap = data;
        } else {
            // Logged for on-device/simulator console visibility, and shown
            // on screen too - "Couldn't load photo" alone gives no way to
            // tell a network failure (e.g. BLE_CONNECTION_UNAVAILABLE,
            // -104) apart from a real server error or a genuinely corrupt
            // image (UNABLE_TO_PROCESS_IMAGE, -1006).
            _errorCode = responseCode;
            System.println("Lumio: image " + _imageId.toString() + " failed to load, code=" + responseCode.toString());
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        if (_bitmap != null) {
            var bitmap = _bitmap as Graphics.BitmapReference;
            if (_zoomLevel == 1) {
                dc.drawBitmap(0, 0, bitmap);
            } else {
                dc.drawScaledBitmap(
                    _offsetX,
                    _offsetY,
                    bitmap.getWidth() * _zoomLevel,
                    bitmap.getHeight() * _zoomLevel,
                    bitmap
                );
            }
        } else if (_loading) {
            dc.drawText(
                dc.getWidth() / 2,
                dc.getHeight() / 2,
                Graphics.FONT_SMALL,
                "Loading...",
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
            );
        } else {
            // Two separate calls rather than a single "\n"-joined string -
            // not confident every FONT_SMALL/device combination in this
            // SDK reliably line-breaks on an embedded newline, and this
            // sidesteps the question entirely.
            dc.drawText(
                dc.getWidth() / 2,
                dc.getHeight() / 2 - 14,
                Graphics.FONT_SMALL,
                "Couldn't load photo",
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
            );
            dc.drawText(
                dc.getWidth() / 2,
                dc.getHeight() / 2 + 14,
                Graphics.FONT_XTINY,
                ConnectionError.describe(_errorCode as Number),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
            );
        }
    }

    // Tap cycles 1x -> 2x -> 3x -> back to 1x, keeping the tapped point
    // under the tap as the zoom level changes (the standard "zoom to
    // point" feel) - called from FullscreenImageDelegate.onTap.
    function zoomAt(tapX as Number, tapY as Number) as Void {
        if (_bitmap == null) {
            return;
        }

        // Where on the *unscaled* image the tap landed, independent of
        // whatever zoom/pan is currently applied.
        var originX;
        var originY;
        if (_zoomLevel == 1) {
            originX = tapX;
            originY = tapY;
        } else {
            originX = (tapX - _offsetX) / _zoomLevel;
            originY = (tapY - _offsetY) / _zoomLevel;
        }

        _zoomLevel = (_zoomLevel % MAX_ZOOM) + 1;

        if (_zoomLevel == 1) {
            _offsetX = 0;
            _offsetY = 0;
        } else {
            _offsetX = tapX - originX * _zoomLevel;
            _offsetY = tapY - originY * _zoomLevel;
            clampOffset();
        }

        WatchUi.requestUpdate();
    }

    function resetZoom() as Void {
        _zoomLevel = 1;
        _offsetX = 0;
        _offsetY = 0;
        WatchUi.requestUpdate();
    }

    // Called from FullscreenImageDelegate.onSwipe while zoomed in;
    // clamped so a pan never drags a blank edge into view.
    function pan(dx as Number, dy as Number) as Void {
        if (_zoomLevel == 1 || _bitmap == null) {
            return;
        }
        _offsetX += dx;
        _offsetY += dy;
        clampOffset();
        WatchUi.requestUpdate();
    }

    function isZoomed() as Boolean {
        return _zoomLevel > 1;
    }

    private function clampOffset() as Void {
        var bitmap = _bitmap as Graphics.BitmapReference;
        var settings = System.getDeviceSettings();
        var scaledWidth = bitmap.getWidth() * _zoomLevel;
        var scaledHeight = bitmap.getHeight() * _zoomLevel;

        _offsetX = clampAxis(_offsetX, scaledWidth, settings.screenWidth);
        _offsetY = clampAxis(_offsetY, scaledHeight, settings.screenHeight);
    }

    // Centers the image on an axis where it's smaller than the screen;
    // otherwise keeps the scaled image edge-to-edge across the screen.
    private function clampAxis(offset as Number, scaledSize as Number, screenSize as Number) as Number {
        if (scaledSize <= screenSize) {
            return (screenSize - scaledSize) / 2;
        }
        var minOffset = screenSize - scaledSize;
        if (offset < minOffset) {
            return minOffset;
        }
        if (offset > 0) {
            return 0;
        }
        return offset;
    }
}
