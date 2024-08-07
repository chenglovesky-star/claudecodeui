package com.iflytek.bigdata.flint.metadata.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ViewByDto {

    private String label;

    private String value;

    private List<ViewByDto> children = new ArrayList<>();

    public ViewByDto() {
    }

    public ViewByDto(String label, String value) {
        this.label = label;
        this.value = value;
    }
}
