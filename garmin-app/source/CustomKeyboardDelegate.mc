import Toybox.Lang;
import Toybox.WatchUi;

class CustomKeyboardDelegate extends WatchUi.BehaviorDelegate {
    private var _view as CustomKeyboardView;
    private var _onConfirm as Method(text as String) as Void;
    // Called with the buffer typed so far whenever the page-switch key is
    // tapped. For a single-page keyboard (no switch key exists on the
    // view), this is simply never invoked - callers that don't need
    // paging pass a harmless no-op.
    private var _onSwitch as Method(text as String) as Void;

    function initialize(
        view as CustomKeyboardView,
        onConfirm as Method(text as String) as Void,
        onSwitch as Method(text as String) as Void
    ) {
        BehaviorDelegate.initialize();
        _view = view;
        _onConfirm = onConfirm;
        _onSwitch = onSwitch;
    }

    function onTap(clickEvent as WatchUi.ClickEvent) as Boolean {
        var coordinates = clickEvent.getCoordinates();
        var slot = _view.slotAt(coordinates[0], coordinates[1]);
        if (slot == null) {
            return true;
        }

        if (_view.isBackspace(slot)) {
            _view.backspace();
        } else if (_view.isConfirm(slot)) {
            _onConfirm.invoke(_view.getBuffer());
        } else if (_view.isSwitch(slot)) {
            _onSwitch.invoke(_view.getBuffer());
        } else {
            _view.appendChar(slot);
        }
        return true;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}
