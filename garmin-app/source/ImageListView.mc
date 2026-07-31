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
    // past that. Each queue entry is [id, item]; _current tracks
    // whichever [id, item] is actually in flight right now.
    private var _thumbnailQueue as Array<[Number, WatchUi.MenuItem]>;
    private var _current as [Number, WatchUi.MenuItem]?;
    private var _filter as Dictionary?;
    // Menu2 only exposes deleteItem(index), not a bulk clear - this
    // tracks how many items are currently added so onShow() can remove
    // exactly that many via repeated deleteItem(0) calls before reloading.
    private var _itemCount as Number;
    // Keyed by photo id, kept across reloads (not cleared in onShow/
    // onHide) - a photo already seen once shows its thumbnail instantly
    // on every later visit instead of re-downloading it, since the list
    // itself now reloads on every return to this view (see onShow).
    // Bounded, not unbounded: a watch has very little spare memory, and
    // everyone's actual photo library lives on the server, not the
    // device - this only ever holds a small working set of recently-seen
    // thumbnails, evicting the oldest once the cap is hit.
    private const MAX_CACHED_THUMBNAILS = 30;
    private var _thumbnailCache as Dictionary<Number, Graphics.BitmapReference>;
    private var _thumbnailCacheOrder as Array<Number>;

    // null = all photos; otherwise a scope filter Dictionary built by
    // FilterMenuDelegate ({"scope" => "favorites"} or {"scope" => "album",
    // "albumId" => n}), passed straight through to LumioApi.
    function initialize(filter as Dictionary?) {
        Menu2.initialize({ :title => "Lumio Photos" });
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _current = null;
        _filter = filter;
        _itemCount = 0;
        _thumbnailCache = {} as Dictionary<Number, Graphics.BitmapReference>;
        _thumbnailCacheOrder = [] as Array<Number>;
        addLoadingItem();
    }

    private function addLoadingItem() as Void {
        addItem(new WatchUi.MenuItem("Loading...", null, :loading, {}));
        _itemCount += 1;
    }

    // Reloads from scratch every time this view becomes visible - both
    // the first time (right after construction) and every time it's
    // revealed again (backing out of a fullscreen photo). Refreshing the
    // list itself matters: without it, a photo that gets favorited,
    // trashed, or deleted via the web dashboard while you're browsing on
    // the watch would keep showing as a valid row indefinitely - tapping
    // it would 404 every time, with no way to recover short of
    // restarting the app. This also runs after the outgoing view's
    // onHide() has already fired (see that comment below), so there's
    // nothing left over to cancel this fetch. The thumbnail cache is
    // deliberately NOT cleared here - only the metadata (name, whether a
    // photo still exists at all) needs to be fresh every time, not the
    // actual pixels, which don't change for a given photo id.
    function onShow() as Void {
        while (_itemCount > 0) {
            deleteItem(0);
            _itemCount -= 1;
        }
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _current = null;
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
        _current = null;
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

            if (_thumbnailCache.hasKey(id)) {
                item.setIcon(_thumbnailCache[id] as Graphics.BitmapReference);
            } else {
                _thumbnailQueue.add([id, item] as [Number, WatchUi.MenuItem]);
            }
        }

        loadNextThumbnail();
    }

    private function loadNextThumbnail() as Void {
        if (_thumbnailQueue.size() == 0) {
            return;
        }

        var next = _thumbnailQueue[0];
        _thumbnailQueue = _thumbnailQueue.slice(1, _thumbnailQueue.size());
        _current = next;

        LumioApi.fetchThumbnail(
            next[0],
            method(:onThumbnailLoaded) as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void
        );
    }

    function onThumbnailLoaded(responseCode as Number, data as Graphics.BitmapReference?) as Void {
        if (responseCode == 200 && data != null && _current != null) {
            var current = _current as [Number, WatchUi.MenuItem];
            current[1].setIcon(data as Graphics.BitmapReference);
            cacheThumbnail(current[0], data as Graphics.BitmapReference);
        }
        _current = null;
        // Keep going regardless of whether that one succeeded - one
        // missing thumbnail shouldn't stall every row after it.
        loadNextThumbnail();
    }

    // Evicts the oldest cached thumbnail once the cap is hit, so this
    // never grows unbounded no matter how large the actual library on
    // the server is - only a small recent working set stays in memory.
    private function cacheThumbnail(id as Number, bitmap as Graphics.BitmapReference) as Void {
        if (!_thumbnailCache.hasKey(id)) {
            _thumbnailCacheOrder.add(id);
        }
        _thumbnailCache[id] = bitmap;

        while (_thumbnailCacheOrder.size() > MAX_CACHED_THUMBNAILS) {
            var oldest = _thumbnailCacheOrder[0];
            _thumbnailCacheOrder = _thumbnailCacheOrder.slice(1, _thumbnailCacheOrder.size());
            _thumbnailCache.remove(oldest);
        }
    }
}
