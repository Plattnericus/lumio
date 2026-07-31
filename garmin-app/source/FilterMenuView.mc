import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.Timer;
import Toybox.WatchUi;

// Shown right after pairing (or on every normal launch once paired) -
// lets you pick what the photo list below it should actually show,
// instead of always dumping every image in one flat list. Non-exclusive
// albums (same model as the web app) show up here exactly as the account
// has them configured - nothing about this menu is hardcoded per-user.
class FilterMenuView extends WatchUi.Menu2 {
    private var _loadStarted as Boolean;
    private var _awaitingAlbums as Boolean;
    private var _timeoutTimer as Timer.Timer?;
    private const LOAD_TIMEOUT_MS = 12000;

    function initialize() {
        Menu2.initialize({ :title => "View" });
        _loadStarted = false;
        _awaitingAlbums = false;
        _timeoutTimer = null;
        addItem(new WatchUi.MenuItem("All Photos", null, :all, {}));
        addItem(new WatchUi.MenuItem("Favorites", null, :favorites, {}));
        addItem(new WatchUi.MenuItem("Loading albums...", null, :loadingAlbums, {}));
    }

    // Started here, not in initialize() - initialize() runs before the
    // incoming view is actually shown, and this only ever needs to run
    // once per instance (unlike ImageListView, an album list changing
    // mid-browse is rare enough not to warrant a reload on every return).
    function onShow() as Void {
        if (_loadStarted) {
            return;
        }
        _loadStarted = true;
        _awaitingAlbums = true;
        LumioApi.fetchAlbums(
            method(:onAlbumsLoaded) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
        );

        _timeoutTimer = new Timer.Timer();
        (_timeoutTimer as Timer.Timer).start(method(:onAlbumsTimeout) as Method() as Void, LOAD_TIMEOUT_MS, false);
    }

    // Doesn't force-cancel here - see ImageListView.onHide's comment for
    // why a global Communications.cancelAllRequests() turned out to be
    // unreliable and was removed everywhere. This view only ever has one
    // request in flight, so an abandoned one finishing quietly in the
    // background is harmless.
    function onHide() as Void {
        _awaitingAlbums = false;
        if (_timeoutTimer != null) {
            (_timeoutTimer as Timer.Timer).stop();
            _timeoutTimer = null;
        }
    }

    function onAlbumsTimeout() as Void {
        _timeoutTimer = null;
        if (!_awaitingAlbums) {
            return;
        }
        onAlbumsLoaded(ConnectionError.CLIENT_TIMEOUT, null);
    }

    function onAlbumsLoaded(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void {
        if (!_awaitingAlbums) {
            return;
        }
        _awaitingAlbums = false;
        if (_timeoutTimer != null) {
            (_timeoutTimer as Timer.Timer).stop();
            _timeoutTimer = null;
        }

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
