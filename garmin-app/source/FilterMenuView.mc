import Toybox.Communications;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.WatchUi;

// Shown right after pairing (or on every normal launch once paired) -
// lets you pick what the photo list below it should actually show,
// instead of always dumping every image in one flat list. Non-exclusive
// albums (same model as the web app) show up here exactly as the account
// has them configured - nothing about this menu is hardcoded per-user.
class FilterMenuView extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({ :title => "View" });
        addItem(new WatchUi.MenuItem("All Photos", null, :all, {}));
        addItem(new WatchUi.MenuItem("Favorites", null, :favorites, {}));
        addItem(new WatchUi.MenuItem("Loading albums...", null, :loadingAlbums, {}));
        LumioApi.fetchAlbums(
            method(:onAlbumsLoaded) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
        );
    }

    // Same reasoning as ImageListView/FullscreenImageView - don't let an
    // abandoned album-list fetch pile up against the next view's own
    // request (Connect IQ limits parallel Communications requests).
    function onHide() as Void {
        Communications.cancelAllRequests();
    }

    function onAlbumsLoaded(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void {
        // "All Photos" and "Favorites" are always at indices 0/1, and this
        // placeholder is always the 3rd item added - fetching albums is
        // best-effort polish, never something the core list waits on, so
        // a failure here just means no album rows get added, not an error
        // screen blocking the two filters that always work.
        deleteItem(2);

        if (responseCode != 200 || data == null) {
            addItem(new WatchUi.MenuItem("Couldn't load albums", ConnectionError.describe(responseCode), :albumsError, {}));
            return;
        }

        var albums = data as Array;
        for (var i = 0; i < albums.size(); i++) {
            var album = albums[i] as Dictionary;
            var id = album.get("id") as Number;
            var name = album.get("name") as String;
            addItem(new WatchUi.MenuItem(name, null, id, {}));
        }
    }
}
