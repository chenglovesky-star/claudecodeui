package com.iflytek.bigdata.flint.analysis.dto;

import lombok.Data;

import java.util.List;

@Data
public class ResultRowDto {

    private List<List<Object>> values;

    private List<String> byValues;
}


