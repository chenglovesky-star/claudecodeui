package com.iflytek.bigdata.flint.common.http;

import okhttp3.*;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class OkHttpUtil {

    public static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    private static OkHttpClient client = new OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build();

    public static String get(String url, List<RequestPair> pairs) throws IOException {

        StringBuilder urlBuilder = new StringBuilder(url);
        if (pairs != null) {
            for (int i = 0; i < pairs.size(); i++) {
                if (i == 0) {
                    urlBuilder.append("?").append(pairs.get(i).getKey()).append("=").append(pairs.get(i).getValue());
                } else {
                    urlBuilder.append("&").append(pairs.get(i).getKey()).append("=").append(pairs.get(i).getValue());
                }
            }
        }
        url = urlBuilder.toString();
        Request request = new Request.Builder().url(url).get().build();
        Response response = client.newCall(request).execute();
        return response.body() == null ? "[]" : response.body().string();
    }

    public static String get(String url, List<RequestPair> pairs, String headerKey, String headerValue) throws IOException {
        StringBuilder urlBuilder = new StringBuilder(url);
        if (pairs != null) {
            for (int i = 0; i < pairs.size(); i++) {
                if (i == 0) {
                    urlBuilder.append("?").append(pairs.get(i).getKey()).append("=").append(pairs.get(i).getValue());
                } else {
                    urlBuilder.append("&").append(pairs.get(i).getKey()).append("=").append(pairs.get(i).getValue());
                }
            }
        }
        url = urlBuilder.toString();
        Request request = new Request.Builder().url(url).addHeader(headerKey, headerValue).get().build();
        Response response = client.newCall(request).execute();
        return response.body() == null ? "[]" : response.body().string();
    }

    public static String postJson(String url, String json) throws IOException {
        RequestBody body = RequestBody.create(JSON, json);
        Request request = new Request.Builder().url(url).post(body).build();
        Response response = client.newCall(request).execute();
        return response.body() == null ? "[]" : response.body().string();
    }

    public static String putJson(String url, String json) throws IOException {
        RequestBody body = RequestBody.create(JSON, json);
        Request request = new Request.Builder().url(url).put(body).build();
        Response response = client.newCall(request).execute();
        return response.body() == null ? "[]" : response.body().string();
    }

    public static String postJson(String url, String json, List<RequestPair> headers) throws IOException {
        RequestBody body = RequestBody.create(JSON, json);
        Request.Builder requestBuilder = new Request.Builder().url(url).post(body);
        for (RequestPair pair : headers) {
            requestBuilder.header(pair.getKey(), String.valueOf(pair.getValue()));
        }
        Response response = client.newCall(requestBuilder.build()).execute();
        return response.body() == null ? "[]" : response.body().string();
    }


    public static String postForm(String url, List<RequestPair> pairs) throws IOException {
        FormBody.Builder params = new FormBody.Builder();
        for (RequestPair pair : pairs) {
            params.add(pair.getKey(), String.valueOf(pair.getValue()));
        }
        Request.Builder requestBuilder = new Request.Builder().url(url);
        Request request = requestBuilder.post(params.build()).build();
        Response response = client.newCall(request).execute();
        return response.body() == null ? "[]" : response.body().string();
    }

    public static String postFormWithHeader(String url, List<RequestPair> pairs) throws IOException {
        FormBody.Builder params = new FormBody.Builder();
        Request.Builder requestBuilder = new Request.Builder().url(url);
        for (RequestPair pair : pairs) {
            requestBuilder.header(pair.getKey(), String.valueOf(pair.getValue()));
        }
        Request request = requestBuilder.post(params.build()).build();
        Response response = client.newCall(request).execute();
        return response.body() == null ? "[]" : response.body().string();
    }
}
