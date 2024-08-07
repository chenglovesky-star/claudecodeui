package com.iflytek.bigdata.flint.hiveserver2.utils;

public class HdfsApiException extends Exception {

    public HdfsApiException(String message) {
        super(message);
    }

    public HdfsApiException(String message, Throwable cause) {
        super(message, cause);
    }
}
