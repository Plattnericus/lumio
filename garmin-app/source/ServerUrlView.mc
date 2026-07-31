import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class ServerUrlView extends WatchUi.View {
    private var _status as String;

    function initialize() {
        View.initialize();
        _status = "Enter your Lumio\nserver's address,\nthen press Select.";
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(
            dc.getWidth() / 2,
            dc.getHeight() / 2,
            Graphics.FONT_SMALL,
            _status,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
    }

    function setStatus(text as String) as Void {
        _status = text;
        WatchUi.requestUpdate();
    }
}
