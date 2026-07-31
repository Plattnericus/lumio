import Toybox.Graphics;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.WatchUi;

class ImageListView extends WatchUi.Menu2 {
    // null = all photos; otherwise a scope filter Dictionary built by
    // FilterMenuDelegate ({"scope" => "favorites"} or {"scope" => "album",
    // "albumId" => n}), passed straight through to LumioApi.
    function initialize(filter as Dictionary?) {
        Menu2.initialize({ :title => "Lumio Photos" });
        addItem(new WatchUi.MenuItem("Loading...", null, :loading, {}));
        LumioApi.fetchImageList(
            filter,
            method(:onImagesLoaded) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
        );
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
            var name = entry.get("name") as String?;
            var label = (name != null && name.length() > 0) ? name : ("Photo " + id.toString());
            var item = new WatchUi.MenuItem(label, null, id, {});
            addItem(item);

            // Small row preview, loaded lazily per row rather than
            // blocking the whole list on every image up front - each
            // request is tiny (LumioApi.THUMBNAIL_SIZE) and fills in
            // whichever row it belongs to whenever it lands.
            var loader = new ThumbnailLoader(item);
            LumioApi.fetchThumbnail(id, loader.method(:onLoaded) as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void);
        }
    }
}
