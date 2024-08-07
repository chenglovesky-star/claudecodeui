package com.iflytek.bigdata.flint.metadata.dto;

import com.iflytek.bigdata.flint.metadata.dao.model.DimColumn;
import lombok.Data;

import java.util.List;

@Data
public class DimDto {

    private Integer id;

    private String name;

    private String hiveTableName;

    private String dimColumn;

    private String event;

    private String property;

    private String partition;

    private List<DimColumn> dimColumnList;
}
