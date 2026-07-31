import Toybox.Application.Properties;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.WatchUi;

// Entry point for first-run setup: everyone self-hosts their own server, so
// there's no default to fall back to here - the address has to come from
// whoever's running this watch. Two keyboard pages (letters, then
// numbers/symbols) cover everything a real server address needs -
// https://, a domain, an optional port, a path - without cramming 40+
// keys onto one small screen.
class ServerUrlDelegate extends WatchUi.BehaviorDelegate {
    private var _view as ServerUrlView;
    private var _pendingUrl as String;

    // "." lives on the letters page too, not just symbols - a domain name
    // needs it far more often than a page-switch tap is worth.
    private const LETTERS = [
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
        "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", ".",
    ];
    private const SYMBOLS = [
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
        ":", "/", "-", "_", "~",
    ];

    function initialize(view as ServerUrlView) {
        BehaviorDelegate.initialize();
        _view = view;
        _pendingUrl = "";
    }

    function onSelect() as Boolean {
        var current = Properties.getValue("serverUrl") as String?;
        var startingText = (current != null && current.length() > 0) ? current : "https://";
        pushLettersPage(startingText);
        return true;
    }

    private function pushLettersPage(startingText as String) as Void {
        var keyboardView = new CustomKeyboardView("Server address", LETTERS as Array<String>, 6, "123");
        keyboardView.setBuffer(startingText);
        var delegate = new CustomKeyboardDelegate(
            keyboardView,
            method(:onUrlEntered) as Method(text as String) as Void,
            method(:onSwitchToSymbols) as Method(text as String) as Void
        );
        WatchUi.pushView(keyboardView, delegate, WatchUi.SLIDE_IMMEDIATE);
    }

    private function pushSymbolsPage(startingText as String) as Void {
        var keyboardView = new CustomKeyboardView("Server address", SYMBOLS as Array<String>, 6, "ABC");
        keyboardView.setBuffer(startingText);
        var delegate = new CustomKeyboardDelegate(
            keyboardView,
            method(:onUrlEntered) as Method(text as String) as Void,
            method(:onSwitchToLetters) as Method(text as String) as Void
        );
        WatchUi.pushView(keyboardView, delegate, WatchUi.SLIDE_IMMEDIATE);
    }

    function onSwitchToSymbols(currentText as String) as Void {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        pushSymbolsPage(currentText);
    }

    function onSwitchToLetters(currentText as String) as Void {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        pushLettersPage(currentText);
    }

    function onUrlEntered(text as String) as Void {
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
}
