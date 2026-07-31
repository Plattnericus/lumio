import Toybox.Application;
import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.WatchUi;

class LumioApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    // Three states, checked in order: no server address yet (first run,
    // or a self-hoster who hasn't pointed this at their own instance) ->
    // no device token yet (address known, not paired) -> paired, go
    // straight to the photo list. No second login system beyond the
    // device token obtained once via pairing.
    function getInitialView() as [ WatchUi.Views ] or [ WatchUi.Views, WatchUi.InputDelegates ] {
        var serverUrl = Properties.getValue("serverUrl") as String?;
        if (serverUrl == null || serverUrl.length() == 0) {
            var urlView = new ServerUrlView();
            return [urlView, new ServerUrlDelegate(urlView)] as [ WatchUi.Views, WatchUi.InputDelegates ];
        }

        var token = Storage.getValue("deviceToken");
        if (token != null) {
            return [new FilterMenuView(), new FilterMenuDelegate()] as [ WatchUi.Views, WatchUi.InputDelegates ];
        }

        var pairingView = new PairingView();
        return [pairingView, new PairingDelegate(pairingView)] as [ WatchUi.Views, WatchUi.InputDelegates ];
    }
}
