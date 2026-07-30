import Toybox.Lang;
import Toybox.WatchUi;

class ImageListDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id instanceof Number) {
            WatchUi.pushView(new FullscreenImageView(id as Number), new FullscreenImageDelegate(), WatchUi.SLIDE_LEFT);
        }
    }
}
