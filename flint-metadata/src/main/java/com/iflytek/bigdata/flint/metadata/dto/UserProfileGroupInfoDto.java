package com.iflytek.bigdata.flint.metadata.dto;

import lombok.Data;

import java.util.Date;

@Data
public class UserProfileGroupInfoDto {

    private Integer id;

    private String name;

    private Date completeTime;
}
