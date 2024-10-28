package com.iflytek.bigdata.flint.metadata.dto;

import lombok.Data;

import java.util.List;

@Data
public class VirtualEventDto {

    private Integer id;

    private String name;

    private String displayName;

    private String description;

    private String tags;

    private List<EventDto> events;

    private Integer display;

    private String sql;

    private Integer op;
}
