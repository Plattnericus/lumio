import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.WatchUi;

class PairingDelegate extends WatchUi.BehaviorDelegate {
    private var _view as PairingView;

    function initialize(view as PairingView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() as Boolean {
        var code = Properties.getValue("pairingCode") as String?;
        if (code == null || code.length() == 0) {
            _view.setStatus("No pairing code set.\nOpen this widget's settings\nin Garmin Connect.");
            return true;
        }

        _view.setStatus("Pairing...");
        LumioApi.exchangePairingCode(code, method(:onExchangeResponse) as Method(responseCode as Number, data as Dictionary?) as Void);
        return true;
    }

    function onExchangeResponse(responseCode as Number, data as Dictionary?) as Void {
        if (responseCode == 200 && data != null && data.hasKey("token")) {
            Storage.setValue("deviceToken", data.get("token"));
            WatchUi.switchToView(new ImageListView(), new ImageListDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else {
            _view.setStatus("Pairing failed.\nCheck the code and\ntry again.");
        }
    }
}
