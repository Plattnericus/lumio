import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.WatchUi;

class ImageListView extends WatchUi.Menu2 {
    // Thumbnails are loaded one at a time, not all at once - Connect IQ
    // limits how many Communications requests can be active in parallel
    // (confirmed against the official docs' own cancelAllRequests()
    // description), and firing one per row simultaneously blew right
    // past that, which is what caused occasional stuck loads and spurious
    // 404s when navigating back and forth. Each entry is [id, item];
    // _currentThumbnailItem tracks whichever one is actually in flight.
    private var _thumbnailQueue as Array<[Number, WatchUi.MenuItem]>;
    private var _currentThumbnailItem as WatchUi.MenuItem?;
    private var _filter as Dictionary?;
    private var _loadStarted as Boolean;

    // null = all photos; otherwise a scope filter Dictionary built by
    // FilterMenuDelegate ({"scope" => "favorites"} or {"scope" => "album",
    // "albumId" => n}), passed straight through to LumioApi.
    function initialize(filter as Dictionary?) {
        Menu2.initialize({ :title => "Lumio Photos" });
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _currentThumbnailItem = null;
        _filter = filter;
        _loadStarted = false;
        addItem(new WatchUi.MenuItem("Loading...", null, :loading, {}));
    }

    // The actual fetch starts here, not in initialize() - this view's
    // constructor runs (and used to fire the fetch) *before*
    // WatchUi.pushView actually swaps views, which is also before the
    // previous view's own onHide() runs. Since onHide() below cancels
    // every outstanding request (Communications.cancelAllRequests() is
    // global, not scoped to one view), starting the fetch in initialize()
    // meant the previous view's onHide() immediately cancelled the
    // request this view had just started - surfaced as "Request was
    // cancelled (-1003)" on literally every navigation into this view.
    // onShow() only runs after the outgoing view's onHide() has already
    // fired, so there's nothing left to cancel by the time this starts.
    // _loadStarted guards against onShow() firing again later (e.g.
    // returning from a fullscreen photo) and re-fetching from scratch.
    function onShow() as Void {
        if (_loadStarted) {
            return;
        }
        _loadStarted = true;
        LumioApi.fetchImageList(
            _filter,
            method(:onImagesLoaded) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
        );
    }

    // However this view stops being the visible one - backing out, or a
    // FullscreenImageView getting pushed on top - abandon anything still
    // in flight so it doesn't pile up against whatever request the next
    // view makes.
    function onHide() as Void {
        Communications.cancelAllRequests();
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _currentThumbnailItem = null;
    }

    function onImagesLoaded(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void {
        deleteItem(0);

        if (responseCode != 200 || data == null) {
            addItem(new WatchUi.MenuItem("Couldn't load photos", ConnectionError.describe(responseCode), :error, {}));
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
            _thumbnailQueue.add([id, item] as [Number, WatchUi.MenuItem]);
        }

        loadNextThumbnail();
    }

    private function loadNextThumbnail() as Void {
        if (_thumbnailQueue.size() == 0) {
            return;
        }

        var next = _thumbnailQueue[0];
        _thumbnailQueue = _thumbnailQueue.slice(1, _thumbnailQueue.size());
        _currentThumbnailItem = next[1];

        LumioApi.fetchThumbnail(
            next[0],
            method(:onThumbnailLoaded) as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void
        );
    }

    function onThumbnailLoaded(responseCode as Number, data as Graphics.BitmapReference?) as Void {
        if (responseCode == 200 && data != null && _currentThumbnailItem != null) {
            (_currentThumbnailItem as WatchUi.MenuItem).setIcon(data as Graphics.BitmapReference);
        }
        _currentThumbnailItem = null;
        // Keep going regardless of whether that one succeeded - one
        // missing thumbnail shouldn't stall every row after it.
        loadNextThumbnail();
    }
}
