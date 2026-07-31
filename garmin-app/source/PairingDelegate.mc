import Toybox.Lang;
import Toybox.WatchUi;

// The code is typed directly on the watch now, not configured ahead of
// time via Garmin Connect Mobile's app settings - it's short-lived and
// single-use, so entering it right where it's needed removes a whole
// round-trip through a phone app.
class PairingDelegate extends WatchUi.BehaviorDelegate {
    private var _view as PairingView;

    function initialize(view as PairingView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() as Boolean {
        var picker = new WatchUi.TextPicker("");
        WatchUi.pushView(picker, new PairingCodeTextDelegate(_view), WatchUi.SLIDE_IMMEDIATE);
        return true;
    }
}
