import Toybox.Application.Properties;
import Toybox.Lang;
import Toybox.WatchUi;

// Entry point for first-run setup: everyone self-hosts their own server, so
// there's no default to fall back to here - the address has to come from
// whoever's running this watch. Reusing the phone-configured value (if one
// was set via Garmin Connect Mobile's app settings, the older path) as the
// starting text saves a full retype when only fixing a typo.
class ServerUrlDelegate extends WatchUi.BehaviorDelegate {
    private var _view as ServerUrlView;

    function initialize(view as ServerUrlView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() as Boolean {
        var current = Properties.getValue("serverUrl") as String?;
        var startingText = (current != null && current.length() > 0) ? current : "https://";
        var picker = new WatchUi.TextPicker(startingText);
        WatchUi.pushView(picker, new ServerUrlTextDelegate(_view), WatchUi.SLIDE_IMMEDIATE);
        return true;
    }
}
