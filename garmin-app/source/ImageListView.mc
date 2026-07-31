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
    // past that. Each entry is [id, item]; _currentThumbnailItem tracks
    // whichever one is actually in flight.
    private var _thumbnailQueue as Array<[Number, WatchUi.MenuItem]>;
    private var _currentThumbnailItem as WatchUi.MenuItem?;
    private var _filter as Dictionary?;
    // Menu2 only exposes deleteItem(index), not a bulk clear - this
    // tracks how many items are currently added so reload() can remove
    // exactly that many via repeated deleteItem(0) calls.
    private var _itemCount as Number;

    // null = all photos; otherwise a scope filter Dictionary built by
    // FilterMenuDelegate ({"scope" => "favorites"} or {"scope" => "album",
    // "albumId" => n}), passed straight through to LumioApi.
    function initialize(filter as Dictionary?) {
        Menu2.initialize({ :title => "Lumio Photos" });
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _currentThumbnailItem = null;
        _filter = filter;
        _itemCount = 0;
        addLoadingItem();
    }

    private function addLoadingItem() as Void {
        addItem(new WatchUi.MenuItem("Loading...", null, :loading, {}));
        _itemCount += 1;
    }

    // Reloads from scratch every time this view becomes visible - both
    // the first time (right after construction) and every time it's
    // revealed again (backing out of a fullscreen photo). Refreshing on
    // every return matters: without it, a photo that gets favorited,
    // trashed, or deleted via the web dashboard while you're browsing on
    // the watch would keep showing as a valid row indefinitely - tapping
    // it would 404 every time, with no way to recover short of
    // restarting the app. This also runs after the outgoing view's
    // onHide() has already fired (see that comment below), so there's
    // nothing left over to cancel this fetch.
    function onShow() as Void {
        while (_itemCount > 0) {
            deleteItem(0);
            _itemCount -= 1;
        }
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _currentThumbnailItem = null;
        addLoadingItem();
        LumioApi.fetchImageList(
            _filter,
            method(:onImagesLoaded) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
        );
    }

    // However this view stops being the visible one - backing out, or a
    // FullscreenImageView getting pushed on top - abandon anything still
    // in flight so it doesn't pile up against whatever request the next
    // view makes (Connect IQ limits parallel Communications requests).
    function onHide() as Void {
        Communications.cancelAllRequests();
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _currentThumbnailItem = null;
    }

    function onImagesLoaded(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void {
        deleteItem(0);
        _itemCount -= 1;

        if (responseCode != 200 || data == null) {
            addItem(new WatchUi.MenuItem("Couldn't load photos", ConnectionError.describe(responseCode), :error, {}));
            _itemCount += 1;
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
            _itemCount += 1;
            return;
        }

        for (var i = 0; i < images.size(); i++) {
            var entry = images[i] as Dictionary;
            var id = entry.get("id") as Number;
            var name = entry.get("name") as String?;
            var label = (name != null && name.length() > 0) ? name : ("Photo " + id.toString());
            var item = new WatchUi.MenuItem(label, null, id, {});
            addItem(item);
            _itemCount += 1;
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
