import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.WatchUi;

class ImageListView extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({ :title => "Lumio Photos" });
        addItem(new WatchUi.MenuItem("Loading...", null, :loading, {}));
        LumioApi.fetchImageList(method(:onImagesLoaded) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void);
    }

    function onImagesLoaded(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void {
        deleteItem(0);

        if (responseCode != 200 || data == null) {
            addItem(new WatchUi.MenuItem("Couldn't load photos", null, :error, {}));
            return;
        }

        // The server's JSON array response is delivered as a Lang.Array at
        // runtime - makeWebRequest's own declared callback type just
        // doesn't include Array in its union (a real gap in the SDK's own
        // type annotations, confirmed by compiling against Connect IQ
        // 9.2.0), so this cast is a deliberate, necessary escape hatch,
        // not a mistake.
        var images = data as Array;
        if (images.size() == 0) {
            addItem(new WatchUi.MenuItem("No photos yet", null, :empty, {}));
            return;
        }

        for (var i = 0; i < images.size(); i++) {
            var entry = images[i] as Dictionary;
            var id = entry.get("id") as Number;
            addItem(new WatchUi.MenuItem("Photo " + id.toString(), null, id, {}));
        }
    }
}
