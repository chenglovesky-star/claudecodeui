package com.iflytek.bigdata.flint.metadata.controller;

import com.alibaba.fastjson.JSONArray;
import com.github.pagehelper.PageInfo;
import com.google.common.base.Joiner;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dao.model.VirtualEventWithBLOBs;
import com.iflytek.bigdata.flint.metadata.dto.EventDto;
import com.iflytek.bigdata.flint.metadata.dto.VirtualEventDto;
import com.iflytek.bigdata.flint.metadata.service.IVirtualEventService;
import com.iflytek.bigdata.flint.metadata.utils.MetadataUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@RestController
@Api(value = "虚拟事件接口")
@CrossOrigin(origins = "*")
@RequestMapping("/iflytek/flint/metadata/virtual/event")
public class VirtualEventController {

    @Resource
    private IVirtualEventService iVirtualEventService;

    @Resource
    private MetadataUtil metadataUtil;

    @ApiOperation(value = "列表", notes = "列表")
    @RequestMapping(value = "/list", method = RequestMethod.GET)
    @ResponseBody
    public Response list(@RequestHeader(value = "ldapUsername", required = false) String operator,
                         @RequestParam(value = "name", required = false) String name,
                         @RequestParam(value = "tag", required = false) String tag,
                         @RequestParam(value = "username", required = false) String username,
                         @RequestParam(value = "pageNum", required = false, defaultValue = "1") int pageNum,
                         @RequestParam(value = "pageSize", required = false, defaultValue = "15") int pageSize) {
        VirtualEventWithBLOBs virtualEvent = new VirtualEventWithBLOBs();
        if (StringUtils.isNotEmpty(name)) {
            virtualEvent.setName(name);
        }
        if (StringUtils.isNotEmpty(username)) {
            virtualEvent.setAddUser(username);
        }
        if (StringUtils.isNotEmpty(tag)) {
            virtualEvent.setTags(tag);
        }
        PageInfo<VirtualEventWithBLOBs> pageInfo = iVirtualEventService.selectByPage(virtualEvent, pageNum, pageSize);
        for (VirtualEventWithBLOBs virtualEventWithBLOBs : pageInfo.getList()) {
            if (StringUtils.isNotEmpty(virtualEventWithBLOBs.getEventFilter())) {
                List<EventDto> events = JSONArray.parseArray(virtualEventWithBLOBs.getEventFilter(), EventDto.class);
                List<String> eventList = new ArrayList<>();
                if (CollectionUtils.isNotEmpty(events)) {
                    for (EventDto eventDto : events) {
                        eventList.add(eventDto.getEvent());
                    }
                }
                virtualEventWithBLOBs.setEvents(Joiner.on(",").join(eventList));
                virtualEventWithBLOBs.setEventSql(null);
                virtualEventWithBLOBs.setEventFilter(null);
            }
        }
        return new Response(pageInfo);
    }

    @ApiOperation(value = "添加", notes = "添加")
    @RequestMapping(value = "/insert", method = RequestMethod.POST)
    @ResponseBody
    public Response insert(@RequestHeader(value = "ldapUsername", required = false) String operator,
                           @RequestBody VirtualEventDto virtualEvent) {
        boolean exists = iVirtualEventService.exists(virtualEvent.getName());
        if (exists) return new Response(1, "虚拟事件名称已存在");
        VirtualEventWithBLOBs event = new VirtualEventWithBLOBs();
        Date now = new Date();
        event.setAddTime(now);
        event.setAddUser(operator);
        event.setName(virtualEvent.getName());
        event.setDisplayName(virtualEvent.getDisplayName());
        event.setDescription(virtualEvent.getDescription());
        event.setTags(virtualEvent.getTags());
        event.setDisplay(virtualEvent.getDisplay());
        event.setEventFilter(JSONArray.toJSONString(virtualEvent.getEvents()));
        event.setOp(virtualEvent.getOp());
        String eventSql = metadataUtil.getEventSql(virtualEvent.getEvents());
        event.setEventSql(eventSql);
        iVirtualEventService.insert(event);
        virtualEvent.setId(event.getId());
        return new Response(event);
    }

    @ApiOperation(value = "编辑", notes = "编辑")
    @RequestMapping(value = "/update", method = RequestMethod.PUT)
    @ResponseBody
    public Response update(@RequestHeader(value = "ldapUsername", required = false) String operator,
                           @RequestBody VirtualEventDto virtualEvent) {
        boolean exists = iVirtualEventService.exists(virtualEvent.getId(), virtualEvent.getName());
        if (exists) return new Response(1, "虚拟事件名称已存在");
        VirtualEventWithBLOBs event = iVirtualEventService.selectById(virtualEvent.getId());
        Date now = new Date();
        event.setAddTime(now);
        event.setAddUser(operator);
        event.setName(virtualEvent.getName());
        event.setDisplayName(virtualEvent.getDisplayName());
        event.setDescription(virtualEvent.getDescription());
        event.setTags(virtualEvent.getTags());
        event.setDisplay(virtualEvent.getDisplay());
        event.setEventFilter(JSONArray.toJSONString(virtualEvent.getEvents()));
        event.setOp(virtualEvent.getOp());
        String eventSql = metadataUtil.getEventSql(virtualEvent.getEvents());
        event.setEventSql(eventSql);
        iVirtualEventService.update(event);
        return new Response(virtualEvent);
    }

    @ApiOperation(value = "详情", notes = "详情")
    @RequestMapping(value = "/detail", method = RequestMethod.GET)
    @ResponseBody
    public Response detail(@RequestHeader(value = "ldapUsername", required = false) String operator, Integer id) {
        VirtualEventWithBLOBs event = iVirtualEventService.selectById(id);
        VirtualEventDto virtualEventDto = new VirtualEventDto();
        if (event.getName() == null) {
            return new Response(200, "虚拟事件不存在");
        }
        virtualEventDto.setId(id);
        virtualEventDto.setName(event.getName());
        virtualEventDto.setDisplayName(event.getDisplayName());
        virtualEventDto.setDescription(event.getDescription());
        virtualEventDto.setTags(event.getTags());
        virtualEventDto.setDisplay(event.getDisplay());
        virtualEventDto.setEvents(JSONArray.parseArray(event.getEventFilter(), EventDto.class));
        virtualEventDto.setOp(event.getOp());
        return new Response(virtualEventDto);
    }

    @ApiOperation(value = "删除", notes = "删除")
    @RequestMapping(value = "/delete", method = RequestMethod.DELETE)
    @ResponseBody
    public Response delete(Integer id) {
        iVirtualEventService.delete(id);
        return new Response(0, "删除成功");
    }

    @ApiOperation(value = "修改隐藏显示", notes = "修改隐藏显示")
    @RequestMapping(value = "/display", method = RequestMethod.POST)
    @ResponseBody
    public Response eventDisplay(@RequestHeader(value = "ldapUsername", required = false) String operator,
                                 @RequestBody VirtualEventDto virtualEvent) {
        VirtualEventWithBLOBs item = iVirtualEventService.selectById(virtualEvent.getId());
        item.setDisplay(virtualEvent.getDisplay());
        iVirtualEventService.update(item);
        return new Response(0, "修改成功");
    }

    @ApiOperation(value = "获取sql", notes = "获取sql")
    @RequestMapping(value = "/sql", method = RequestMethod.GET)
    @ResponseBody
    public Response sql(String name) {
        VirtualEventWithBLOBs search = new VirtualEventWithBLOBs();
        search.setName(name);
        List<VirtualEventWithBLOBs> events = iVirtualEventService.select(search);
        if (CollectionUtils.isNotEmpty(events)) return new Response(events.get(0).getEventSql());
        return new Response(1, "虚拟事件不存在");
    }

}
