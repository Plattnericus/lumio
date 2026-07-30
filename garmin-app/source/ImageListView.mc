import Toybox.Lang;
import Toybox.WatchUi;

class ImageListView extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({ :title => "Lumio Photos" });
        addItem(new WatchUi.MenuItem("Loading...", null, :loading, {}));
        LumioApi.fetchImageList(method(:onImagesLoaded) as Method(responseCode as Number, data as Dictionary or Array or Null) as Void);
    }

    function onImagesLoaded(responseCode as Number, data as Dictionary or Array or Null) as Void {
        deleteItem(0);

        if (responseCode != 200 || data == null) {
            addItem(new WatchUi.MenuItem("Couldn't load photos", null, :error, {}));
            return;
        }

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
