package com.iflytek.bigdata.flint.analysis.dto;

import lombok.Data;

import java.util.List;

@Data
public class ResultDto {

    private Boolean full = true;

    private List<String> events;

    private List<Integer> countTypes;

    private List<String> byFields;

    private List<String> byFieldsShowName;

    private List<String> series;

    private List<ResultRowDto> rows;
}


