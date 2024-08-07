package com.iflytek.bigdata.flint.common.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class Response<T> {

    private Integer code;

    private String message;

    private T data;

    public Response(Integer code, String message) {
        this.code = code;
        this.message = message;
    }

    public Response(T data) {
        this.code = 0;
        this.data = data;
    }
}
