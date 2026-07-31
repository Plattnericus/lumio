import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.PersistedContent;

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

    function fetchImageList(callback as Method(responseCode as Number, data as Dictionary or String or PersistedContent.Iterator or Null) as Void) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Authorization" => "Bearer " + (Storage.getValue("deviceToken") as String) },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
        };
        Communications.makeWebRequest(serverUrl() + "/api/garmin/images", null, options, callback);
    }

    function fetchImage(id as Number, callback as Method(responseCode as Number, data as Graphics.BitmapReference?) as Void) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Authorization" => "Bearer " + (Storage.getValue("deviceToken") as String) },
            :maxWidth => 260,
            :maxHeight => 260,
        };
        Communications.makeImageRequest(serverUrl() + "/api/garmin/images/" + id.toString(), null, options, callback);
    }
}
