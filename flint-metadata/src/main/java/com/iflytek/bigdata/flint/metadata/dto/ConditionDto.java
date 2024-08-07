package com.iflytek.bigdata.flint.metadata.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class ConditionDto {

    private String columnName;

    private Integer columnType;

    private String operationName;

    private String operationValue;
}
