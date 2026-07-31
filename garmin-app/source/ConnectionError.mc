import Toybox.Communications;
import Toybox.Lang;

// Turns a Communications callback's responseCode into a short, human
// message plus the raw code (e.g. "No connection to phone (-104)") -
// every mapping below is taken directly from the official Connect IQ API
// reference for Toybox.Communications, not guessed. HTTP status codes
// (the server's own responses, 200-599) are handled separately from the
// platform's own negative error constants, since both are valid values
// for the same responseCode parameter.
module ConnectionError {
    // Not a real Connect IQ constant - a locally-made-up sentinel for
    // "the response never arrived at all within our own timeout window."
    // Connect IQ can silently drop a callback for an abandoned request
    // with no error delivered, which otherwise leaves "Loading..." on
    // screen forever; using a code clearly outside the platform's own
    // range (rather than reusing e.g. -1) keeps this message honest
    // about what actually happened, instead of implying a real
    // Bluetooth-layer error occurred when none was ever reported.
    const CLIENT_TIMEOUT = -777777;

    function describe(responseCode as Number) as String {
        if (responseCode == CLIENT_TIMEOUT) {
            return "Timed out waiting for a response";
        }
        if (responseCode == 401) {
            return "Not paired - re-pair this watch (401)";
        }
        if (responseCode == 404) {
            return "Not found on server (404)";
        }
        if (responseCode >= 400 && responseCode < 500) {
            return "Server rejected the request (" + responseCode.toString() + ")";
        }
        if (responseCode >= 500 && responseCode < 600) {
            return "Server error (" + responseCode.toString() + ")";
        }

        switch (responseCode) {
            case Communications.BLE_ERROR:
                return "Bluetooth error (-1)";
            case Communications.BLE_HOST_TIMEOUT:
                return "Phone didn't respond in time (-2)";
            case Communications.BLE_SERVER_TIMEOUT:
                return "Server didn't respond in time (-3)";
            case Communications.BLE_NO_DATA:
                return "Empty response (-4)";
            case Communications.BLE_REQUEST_CANCELLED:
                return "Request was cancelled (-5)";
            case Communications.BLE_QUEUE_FULL:
                return "Too many requests at once (-101)";
            case Communications.BLE_REQUEST_TOO_LARGE:
                return "Request too large (-102)";
            case Communications.BLE_UNKNOWN_SEND_ERROR:
                return "Couldn't send request (-103)";
            case Communications.BLE_CONNECTION_UNAVAILABLE:
                return "No connection to phone (-104)";
            case Communications.INVALID_HTTP_HEADER_FIELDS_IN_REQUEST:
                return "Invalid request headers (-200)";
            case Communications.INVALID_HTTP_BODY_IN_REQUEST:
                return "Invalid request body (-201)";
            case Communications.INVALID_HTTP_METHOD_IN_REQUEST:
                return "Invalid request method (-202)";
            case Communications.NETWORK_REQUEST_TIMED_OUT:
                return "Request timed out (-300)";
            case Communications.INVALID_HTTP_BODY_IN_NETWORK_RESPONSE:
                return "Invalid response from server (-400)";
            case Communications.INVALID_HTTP_HEADER_FIELDS_IN_NETWORK_RESPONSE:
                return "Invalid response headers (-401)";
            case Communications.NETWORK_RESPONSE_TOO_LARGE:
                return "Response too large (-402)";
            case Communications.NETWORK_RESPONSE_OUT_OF_MEMORY:
                return "Ran out of memory (-403)";
            case Communications.STORAGE_FULL:
                return "Watch storage is full (-1000)";
            case Communications.SECURE_CONNECTION_REQUIRED:
                return "Needs a secure connection (-1001)";
            case Communications.UNSUPPORTED_CONTENT_TYPE_IN_RESPONSE:
                return "Unsupported content type (-1002)";
            case Communications.REQUEST_CANCELLED:
                return "Request was cancelled (-1003)";
            case Communications.REQUEST_CONNECTION_DROPPED:
                return "Connection dropped (-1004)";
            case Communications.UNABLE_TO_PROCESS_MEDIA:
                return "File couldn't be read (-1005)";
            case Communications.UNABLE_TO_PROCESS_IMAGE:
                return "Photo couldn't be processed (-1006)";
            case Communications.UNABLE_TO_PROCESS_HLS:
                return "Video couldn't be processed (-1007)";
            default:
                return "Unknown error (" + responseCode.toString() + ")";
        }
    }
}
