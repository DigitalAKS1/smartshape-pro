import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';

/// A dio [HttpClientAdapter] that routes requests to a caller-supplied handler,
/// so repositories/interceptors can be tested without a real network.
class StubAdapter implements HttpClientAdapter {
  StubAdapter(this.handler);

  /// Returns `(statusCode, jsonBody)` for a given request.
  final (int, Object?) Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final (status, body) = handler(options);
    // Encode the body as-is so a `null` body round-trips to JSON null (the
    // backend returns null for e.g. "no attendance today"), not {}.
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Decodes a dio request body (Map or JSON string) to a Map for assertions.
Map<String, dynamic> bodyAsMap(RequestOptions o) {
  final d = o.data;
  if (d is Map) return Map<String, dynamic>.from(d);
  if (d is String && d.isNotEmpty) {
    return Map<String, dynamic>.from(jsonDecode(d) as Map);
  }
  return <String, dynamic>{};
}
