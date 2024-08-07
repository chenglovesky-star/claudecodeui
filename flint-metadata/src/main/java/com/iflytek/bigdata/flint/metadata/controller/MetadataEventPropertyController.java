package com.iflytek.bigdata.flint.metadata.controller;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEventProperty;
import com.iflytek.bigdata.flint.metadata.dto.DisplayDto;
import com.iflytek.bigdata.flint.metadata.service.IMetadataEventPropertyService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;

@RestController
@Api(value = "事件属性接口")
@RequestMapping("/iflytek/flint/metadata/property")
public class MetadataEventPropertyController {

    @Resource
    private IMetadataEventPropertyService iMetadataEventPropertyService;

    @ApiOperation(value = "属性列表", notes = "属性列表")
    @GetMapping("/list")
    @ResponseBody
    public Response list(@RequestParam(value = "eventName") String eventName,
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "showName", required = false) String showName,
            @RequestParam(value = "show", required = false) Integer display,
            @RequestParam(value = "pageNum", required = false, defaultValue = "1") int pageNum,
            @RequestParam(value = "pageSize", required = false, defaultValue = "15") int pageSize) {
        MetadataEventProperty item = new MetadataEventProperty();
        if (StringUtils.isNotEmpty(eventName)) {
            item.setEventName(eventName);
        }
        if (StringUtils.isNotEmpty(name)) {
            item.setName(name);
        }
        if (StringUtils.isNotEmpty(showName)) {
            item.setShowName(showName);
        }
        if (display != null) {
            item.setDisplay(display);
        }
        PageInfo<MetadataEventProperty> pageInfo = iMetadataEventPropertyService.selectByPage(item, pageNum, pageSize);
        return new Response(pageInfo);
    }

    @ApiOperation(value = "属性新增", notes = "属性新增")
    @PostMapping("/insert")
    @ResponseBody
    public Response insert(@RequestBody MetadataEventProperty item) {
        String name = item.getName();
        String event = item.getEventName();
        MetadataEventProperty metadataEventProperty = iMetadataEventPropertyService.selectByEventAndName(event, name);
        if (metadataEventProperty == null) {
            iMetadataEventPropertyService.insert(item);
            return new Response("操作成功");
        }
        return new Response("该属性已经存在");
    }

    @ApiOperation(value = "属性修改", notes = "属性详情修改")
    @PostMapping("/update")
    @ResponseBody
    public Response update(@RequestBody MetadataEventProperty item) {
        iMetadataEventPropertyService.update(item);
        return new Response("操作成功");
    }

    @ApiOperation(value = "属性删除", notes = "属性删除")
    @RequestMapping(value = "/delete", method = RequestMethod.DELETE)
    @ResponseBody
    public Response delete(Integer id) {
        MetadataEventProperty metadataEventProperty = iMetadataEventPropertyService.selectById(id);
        if (metadataEventProperty != null) {
            iMetadataEventPropertyService.delete(id);
            return new Response("操作成功");
        }
        return new Response("埋点属性不存在");
    }

    @ApiOperation(value = "更改是否显示", notes = "更改是否显示")
    @PostMapping("/display")
    @ResponseBody
    public Response display(@RequestBody DisplayDto displayDto) {
        MetadataEventProperty item = iMetadataEventPropertyService.selectById(displayDto.getId());
        if (item != null) {
            item.setDisplay(displayDto.getDisplay());
            iMetadataEventPropertyService.update(item);
            return new Response("操作成功");
        }
        return new Response(200, "操作失败");
    }

}
