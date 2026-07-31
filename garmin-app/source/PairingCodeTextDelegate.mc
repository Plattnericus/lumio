import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.WatchUi;

class PairingCodeTextDelegate extends WatchUi.TextPickerDelegate {
    private var _view as PairingView;

    function initialize(view as PairingView) {
        TextPickerDelegate.initialize();
        _view = view;
    }

    function onTextEntered(text as String, changed as Boolean) as Boolean {
        // Codes are generated uppercase (Crockford-ish alphabet, no
        // 0/O/1/I) - normalize case here so a lowercase entry still works.
        var code = text.toUpper();

        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        _view.setStatus("Pairing...");
        LumioApi.exchangePairingCode(code, method(:onExchangeResponse) as Method(responseCode as Number, data as Dictionary?) as Void);
        return true;
    }

    function onExchangeResponse(responseCode as Number, data as Dictionary?) as Void {
        if (responseCode == 200 && data != null && data.hasKey("token")) {
            Storage.setValue("deviceToken", data.get("token"));
            WatchUi.switchToView(new ImageListView(), new ImageListDelegate(), WatchUi.SLIDE_IMMEDIATE);
        } else {
            _view.setStatus("That code didn't work.\nCheck it and try again.");
        }
    }

    function onCancel() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
    }
}
