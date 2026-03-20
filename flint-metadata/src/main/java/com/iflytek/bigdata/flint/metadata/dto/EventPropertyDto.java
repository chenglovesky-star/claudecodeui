package com.iflytek.bigdata.flint.metadata.dto;

import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventProperty;
import com.iflytek.bigdata.flint.metadata.dao.model.Operation;
import lombok.Data;

import java.util.List;

@Data
public class EventPropertyDto {

    private String propertyName;

    private Integer propertyOperationId;

    private String propertyOperationValue;

    private String propertyOperationValue1;

    private String propertyOperationValue2;

    private String propertyType;

    private Integer selectType;

    private String typeGroupValue;

    private List<Operation> propertyOperationList;

    private List<MetadataEventProperty> propertyList;
}
