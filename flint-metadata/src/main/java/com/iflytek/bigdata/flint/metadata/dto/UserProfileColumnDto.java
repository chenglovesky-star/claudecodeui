package com.iflytek.bigdata.flint.metadata.dto;

import lombok.Data;

@Data
public class UserProfileColumnDto {

    private String name;

    private String showName;

    private Integer categoryId;

    private Integer type;

    private String enumValues;

}
