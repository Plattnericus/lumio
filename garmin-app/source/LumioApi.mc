import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.PersistedContent;
import Toybox.System;

// Thin wrapper around the three endpoints this app ever calls. Server URL
// and pairing code are both user-configured Connect IQ settings (entered
// in the Garmin Connect Mobile app), never hardcoded here - this repo is
// public and the server address isn't anyone's business but the owner's.
module LumioApi {

    function serverUrl() as String {
        var url = Properties.getValue("serverUrl") as String?;
        return (url != null) ? url : "";
    }

    function exchangePairingCode(code as String, callback as Method(responseCode as Number, data as Dictionary?) as Void) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };
        Communications.makeWebRequest(serverUrl() + "/api/pairing/exchange", { "code" => code }, options, callback);
    }

    // Used only during first-run setup, before a server address is saved -
    // a quick, unauthenticated hit of the health endpoint so a typo'd
    // address fails fast with a clear message instead of silently being
    // saved and only surfacing as a mysterious pairing failure later.
    function checkServerReachable(url as String, callback as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };
        Communications.makeWebRequest(url + "/api/health", null, options, callback);
    }

    // filter is null for "all photos", or a Dictionary matching the web
    // API's own scope params - {"scope" => "favorites"} or {"scope" =>
    // "album", "albumId" => n} - makeWebRequest serializes it into the
    // query string itself for a GET request, no manual URL-building here.
    function fetchImageList(
        filter as Dictionary?,
        callback as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void
    ) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Authorization" => "Bearer " + (Storage.getValue("deviceToken") as String) },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };
        Communications.makeWebRequest(serverUrl() + "/api/garmin/images", filter, options, callback);
    }

    function fetchAlbums(callback as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Authorization" => "Bearer " + (Storage.getValue("deviceToken") as String) },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };
        Communications.makeWebRequest(serverUrl() + "/api/garmin/albums", null, options, callback);
    }

    // maxWidth/maxHeight are the caller's to choose - the fullscreen view
    // asks for the real screen size, the list's row previews ask for
    // something tiny, both hitting the exact same preview-rendition
    // endpoint (GCM/the device itself does the actual downscaling, per
    // Communications.makeImageRequest's own docs - the server always
    // serves the same mid-size preview rendition regardless of what's
    // requested here).
    function fetchImage(
        id as Number,
        maxWidth as Number,
        maxHeight as Number,
        callback as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void
    ) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Authorization" => "Bearer " + (Storage.getValue("deviceToken") as String) },
            :maxWidth => maxWidth,
            :maxHeight => maxHeight,
        };
        Communications.makeImageRequest(serverUrl() + "/api/garmin/images/" + id.toString(), null, options, callback);
    }

    // A small row-preview icon for the photo list - same endpoint as the
    // fullscreen fetch, just requested much smaller.
    const THUMBNAIL_SIZE = 64;

    function fetchThumbnail(id as Number, callback as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void) as Void {
        fetchImage(id, THUMBNAIL_SIZE, THUMBNAIL_SIZE, callback);
    }
}
