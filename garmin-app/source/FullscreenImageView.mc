import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class FullscreenImageView extends WatchUi.View {
    private var _imageId as Number;
    private var _bitmap as Graphics.BitmapReference?;
    private var _loading as Boolean;

    function initialize(imageId as Number) {
        View.initialize();
        _imageId = imageId;
        _loading = true;
    }

    function onShow() as Void {
        // Fetched from a fixed watch-sized preview rendition on the
        // server, not the original - no reason to move a full-resolution
        // photo over Bluetooth to a screen this small.
        LumioApi.fetchImage(_imageId, method(:onImageLoaded) as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void);
    }

    function onImageLoaded(responseCode as Number, data as Graphics.BitmapReference?) as Void {
        _loading = false;
        if (responseCode == 200) {
            _bitmap = data;
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        if (_bitmap != null) {
            dc.drawBitmap(0, 0, _bitmap as Graphics.BitmapReference);
        } else {
            var message = _loading ? "Loading..." : "Couldn't load photo";
            dc.drawText(
                dc.getWidth() / 2,
                dc.getHeight() / 2,
                Graphics.FONT_SMALL,
                message,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
            );
        }
    }
}
