package com.iflytek.bigdata.flint.metadata.dto;

import lombok.Data;

import java.util.List;

@Data
public class PropertyFilterDto {

    private String relation;

    private List<EventPropertyDto> subFilters;

}
