import Toybox.Application;
import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.WatchUi;

class LumioApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    // No second login system - a device token obtained once via the
    // pairing flow is all this app ever needs to talk to the server.
    function getInitialView() as Array<WatchUi.Views or WatchUi.InputDelegates>? {
        var token = Storage.getValue("deviceToken");
        if (token != null) {
            return [new ImageListView(), new ImageListDelegate()] as Array<WatchUi.Views or WatchUi.InputDelegates>;
        }

        var view = new PairingView();
        return [view, new PairingDelegate(view)] as Array<WatchUi.Views or WatchUi.InputDelegates>;
    }
}
