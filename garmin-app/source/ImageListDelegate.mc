import Toybox.Lang;
import Toybox.WatchUi;

class ImageListDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id instanceof Number) {
            var view = new FullscreenImageView(id as Number);
            WatchUi.pushView(view, new FullscreenImageDelegate(view), WatchUi.SLIDE_LEFT);
        }
    }
}
