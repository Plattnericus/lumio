import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// One instance per photo-list row. A single shared callback couldn't tell
// which in-flight thumbnail request a response belongs to once more than
// one is outstanding at a time (they don't necessarily resolve in the
// order they were sent) - so each row gets its own tiny loader holding a
// reference to its own MenuItem, and calls setIcon on exactly that item
// when its own request lands.
class ThumbnailLoader {
    private var _item as WatchUi.MenuItem;

    function initialize(item as WatchUi.MenuItem) {
        _item = item;
    }

    function onLoaded(responseCode as Number, data as Graphics.BitmapReference?) as Void {
        if (responseCode == 200 && data != null) {
            _item.setIcon(data as Graphics.BitmapReference);
        }
        // A failed thumbnail just leaves the row showing its text label
        // only - not worth an error state for a single row preview.
    }
}
