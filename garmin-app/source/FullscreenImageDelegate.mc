import Toybox.Lang;
import Toybox.WatchUi;

class FullscreenImageDelegate extends WatchUi.BehaviorDelegate {
    private var _view as FullscreenImageView;

    private const PAN_STEP = 40;

    function initialize(view as FullscreenImageView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    // Tap cycles zoom (1x -> 2x -> 3x -> 1x), centered on the tapped point.
    function onTap(clickEvent as WatchUi.ClickEvent) as Boolean {
        var coordinates = clickEvent.getCoordinates();
        _view.zoomAt(coordinates[0], coordinates[1]);
        return true;
    }

    // Swipe pans while zoomed in; left alone (returns false) at 1x so it
    // doesn't swallow any default swipe behavior the platform expects.
    function onSwipe(swipeEvent as WatchUi.SwipeEvent) as Boolean {
        if (!_view.isZoomed()) {
            return false;
        }

        var direction = swipeEvent.getDirection();
        if (direction == WatchUi.SWIPE_LEFT) {
            _view.pan(-PAN_STEP, 0);
        } else if (direction == WatchUi.SWIPE_RIGHT) {
            _view.pan(PAN_STEP, 0);
        } else if (direction == WatchUi.SWIPE_UP) {
            _view.pan(0, -PAN_STEP);
        } else if (direction == WatchUi.SWIPE_DOWN) {
            _view.pan(0, PAN_STEP);
        }
        return true;
    }

    // Hold resets back to 1x - the quick way out of a zoomed-in view.
    function onHold(clickEvent as WatchUi.ClickEvent) as Boolean {
        if (_view.isZoomed()) {
            _view.resetZoom();
            return true;
        }
        return false;
    }
}
