import Toybox.Lang;
import Toybox.WatchUi;

class FilterMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        var filter = null;

        if (id instanceof Symbol) {
            if (id == :favorites) {
                filter = { "scope" => "favorites" };
            } else if (id == :all) {
                filter = null;
            } else {
                // :loadingAlbums - not a real row, ignore a stray tap.
                return;
            }
        } else if (id instanceof Number) {
            filter = { "scope" => "album", "albumId" => id };
        } else {
            return;
        }

        var view = new ImageListView(filter as Dictionary?);
        WatchUi.pushView(view, new ImageListDelegate(), WatchUi.SLIDE_LEFT);
    }
}
