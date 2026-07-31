import Toybox.Application.Properties;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.WatchUi;

// Validates the address before ever saving it - a typo'd URL saved
// silently would strand the user on a screen with no visible way to tell
// what went wrong. Only commits to Properties once the server actually
// answers, and lets the user go straight back into the same text entry to
// fix a typo rather than dead-ending on an error screen.
class ServerUrlTextDelegate extends WatchUi.TextPickerDelegate {
    private var _view as ServerUrlView;
    private var _pendingUrl as String;

    function initialize(view as ServerUrlView) {
        TextPickerDelegate.initialize();
        _view = view;
        _pendingUrl = "";
    }

    function onTextEntered(text as String, changed as Boolean) as Boolean {
        var url = text;
        if (url.length() > 0 && url.substring(url.length() - 1, url.length()).equals("/")) {
            url = url.substring(0, url.length() - 1);
        }
        _pendingUrl = url;

        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        _view.setStatus("Checking " + url + " ...");
        LumioApi.checkServerReachable(
            url,
            method(:onCheckResponse) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
        );
        return true;
    }

    function onCheckResponse(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void {
        if (responseCode == 200) {
            Properties.setValue("serverUrl", _pendingUrl);
            var pairingView = new PairingView();
            WatchUi.switchToView(pairingView, new PairingDelegate(pairingView), WatchUi.SLIDE_IMMEDIATE);
        } else {
            _view.setStatus("Couldn't reach that\nserver. Check the\naddress and try again.");
        }
    }

    function onCancel() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
    }
}
