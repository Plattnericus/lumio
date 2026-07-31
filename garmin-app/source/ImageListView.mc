import Toybox.Graphics;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.Timer;
import Toybox.WatchUi;

class ImageListView extends WatchUi.Menu2 {
    // Thumbnails are loaded one at a time, not all at once - Connect IQ
    // limits how many Communications requests can be active in parallel
    // (confirmed against the official docs). Each queue entry is
    // [id, item]; _current tracks whichever [id, item] is actually in
    // flight right now.
    private var _thumbnailQueue as Array<[Number, WatchUi.MenuItem]>;
    private var _current as [Number, WatchUi.MenuItem]?;
    private var _filter as Dictionary?;
    // Menu2 only exposes deleteItem(index), not a bulk clear - this
    // tracks how many items are currently added so onShow() can remove
    // exactly that many via repeated deleteItem(0) calls before reloading.
    private var _itemCount as Number;
    // Keyed by photo id, kept across reloads - a photo already seen once
    // shows its thumbnail instantly on every later visit instead of
    // re-downloading it, since the list itself reloads on every return
    // to this view (see onShow). Bounded, not unbounded: a watch has
    // very little spare memory, and the real photo library lives on the
    // server, not the device.
    private const MAX_CACHED_THUMBNAILS = 30;
    private var _thumbnailCache as Dictionary<Number, Graphics.BitmapReference>;
    private var _thumbnailCacheOrder as Array<Number>;

    // Whether the list request started by the most recent onShow() is
    // still outstanding. Used two ways: (1) onImagesLoaded ignores a
    // callback that arrives after this is already false (a stale
    // response - already handled by a timeout, or left over from a view
    // that's no longer active); (2) the timeout below only fires the
    // "couldn't load" fallback if a real response genuinely never
    // arrived at all, which does happen - Connect IQ can silently drop a
    // callback for an abandoned request with no error delivered, which
    // otherwise leaves "Loading..." on screen forever with no way to
    // recover short of restarting the whole app.
    private var _awaitingList as Boolean;
    private var _timeoutTimer as Timer.Timer?;
    private const LOAD_TIMEOUT_MS = 12000;

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
        _awaitingList = false;
        _timeoutTimer = null;
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
    // restarting the app. The thumbnail cache is deliberately NOT
    // cleared here - only the metadata (name, whether a photo still
    // exists at all) needs to be fresh every time, not the actual
    // pixels, which don't change for a given photo id.
    function onShow() as Void {
        while (_itemCount > 0) {
            deleteItem(0);
            _itemCount -= 1;
        }
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _current = null;
        addLoadingItem();

        _awaitingList = true;
        LumioApi.fetchImageList(
            _filter,
            method(:onImagesLoaded) as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
        );

        if (_timeoutTimer != null) {
            (_timeoutTimer as Timer.Timer).stop();
        }
        _timeoutTimer = new Timer.Timer();
        (_timeoutTimer as Timer.Timer).start(method(:onListTimeout) as Method() as Void, LOAD_TIMEOUT_MS, false);
    }

    // This view no longer force-cancels outstanding requests here. It
    // used to (Communications.cancelAllRequests()), on the reasoning that
    // an abandoned request would otherwise pile up against whatever the
    // next view fetches - but that cancellation is global, not scoped to
    // this view, and exactly when it runs relative to the next view's
    // own onShow() turned out not to be reliable: it intermittently
    // cancelled a request the *next* view had only just started,
    // surfacing as spurious "cancelled"/"not found" errors on otherwise
    // valid photos. Each view here only ever has one request in flight
    // at a time, so letting an abandoned one finish quietly in the
    // background (its result is simply never looked at again) is
    // harmless, and safer than a global cancel with unpredictable timing.
    function onHide() as Void {
        _thumbnailQueue = [] as Array<[Number, WatchUi.MenuItem]>;
        _current = null;
        _awaitingList = false;
        if (_timeoutTimer != null) {
            (_timeoutTimer as Timer.Timer).stop();
            _timeoutTimer = null;
        }
    }

    function onListTimeout() as Void {
        _timeoutTimer = null;
        if (!_awaitingList) {
            return;
        }
        onImagesLoaded(ConnectionError.CLIENT_TIMEOUT, null);
    }

    function onImagesLoaded(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void {
        if (!_awaitingList) {
            // Stale - already handled (timed out) or left over from a
            // load this view no longer cares about. Ignore it entirely
            // rather than risk touching items that don't match what
            // triggered this response.
            return;
        }
        _awaitingList = false;
        if (_timeoutTimer != null) {
            (_timeoutTimer as Timer.Timer).stop();
            _timeoutTimer = null;
        }

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
