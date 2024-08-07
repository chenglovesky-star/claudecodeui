package com.iflytek.bigdata.flint.metadata.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class EnumValueDto implements Serializable {

    private String value;

    private String showValue;
}
