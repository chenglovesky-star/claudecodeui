package com.iflytek.bigdata.flint.metadata.controller;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataEvent;
import com.iflytek.bigdata.flint.metadata.dto.DisplayDto;
import com.iflytek.bigdata.flint.metadata.service.IMetadataEventService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;

@RestController
@Api(value = "元事件接口")
@RequestMapping("/iflytek/flint/metadata/event")
public class MetadataEventController {

    @Resource
    private IMetadataEventService iMetadataEventService;

    @ApiOperation(value = "埋点列表", notes = "埋点列表")
    @GetMapping("/list")
    @ResponseBody
    public Response list(@RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "tags", required = false) String tags,
            @RequestParam(value = "show", required = false) Integer display,
            @RequestParam(value = "modules", required = false) String modules,
            @RequestParam(value = "pageNum", required = false, defaultValue = "1") int pageNum,
            @RequestParam(value = "pageSize", required = false, defaultValue = "15") int pageSize) {
        MetadataEvent metadataEvent = new MetadataEvent();
        if (StringUtils.isNotEmpty(name)) {
            metadataEvent.setName(name);
        }
        if (StringUtils.isNotEmpty(tags)) {
            metadataEvent.setTags(tags);
        }
        if (display != null) {
            metadataEvent.setDisplay(display);
        }
        if(StringUtils.isNotEmpty(modules)){
            metadataEvent.setModules(modules);
        }
        PageInfo<MetadataEvent> pageInfo = iMetadataEventService.selectByPage(metadataEvent, pageNum, pageSize);
        return new Response(pageInfo);
    }

    @ApiOperation(value = "埋点详情", notes = "埋点详情")
    @GetMapping("/detail")
    @ResponseBody
    public Response detail(Integer id) {
        MetadataEvent item = iMetadataEventService.selectById(id);
        return new Response(item);
    }

    @ApiOperation(value = "埋点修改", notes = "埋点详情修改")
    @PostMapping("/update")
    @ResponseBody
    public Response update(@RequestBody MetadataEvent item) {
        iMetadataEventService.update(item);
        return new Response("操作成功");
    }


    @ApiOperation(value = "埋点新增", notes = "埋点新增")
    @PostMapping("/insert")
    @ResponseBody
    public Response insert(@RequestBody MetadataEvent item) {
        iMetadataEventService.insert(item);
        return new Response("操作成功");
    }

    @ApiOperation(value = "埋点删除", notes = "埋点删除")
    @RequestMapping(value = "/delete", method = RequestMethod.DELETE)
    @ResponseBody
    public Response delete(Integer id) {
        MetadataEvent metadataEvent = iMetadataEventService.selectById(id);
        if (metadataEvent != null) {
            iMetadataEventService.delete(id);
            // todo 需要把该事件下的属性一起删除级联删除
            return new Response("操作成功");
        }
        return new Response("埋点不存在");
    }

    @ApiOperation(value = "更改是否显示", notes = "更改是否显示")
    @PostMapping("/display")
    @ResponseBody
    public Response display(@RequestBody DisplayDto displayDto) {
        MetadataEvent item = iMetadataEventService.selectById(displayDto.getId());
        if (item != null) {
            item.setDisplay(displayDto.getDisplay());
            iMetadataEventService.update(item);
            return new Response("操作成功");
        }
        return new Response(200, "操作失败");
    }

}
