-- ============================================================================
-- 智慧社区治理平台 · MySQL 5.7 生产库建表基线（Demo 迁移路径）
-- 对应说明书 5.1 数据表规划：基础表 19 张 + 增量表 13 张 ≈ 30 张
-- 组织编码采用层级前缀规则：450102 -> 45010201 -> 4501020101 -> 450102010101
-- 所有业务表带 org_code 索引，供 MyBatis-Plus 拦截器统一注入 LIKE '前缀%' 条件
-- ============================================================================
CREATE DATABASE IF NOT EXISTS zhsq_governance DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE zhsq_governance;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------- 基础表（19 张） -------------------------
DROP TABLE IF EXISTS sys_user;
CREATE TABLE sys_user (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL COMMENT '登录账号',
  password_hash VARCHAR(128) NOT NULL COMMENT '密码摘要（生产环境加盐哈希）',
  real_name VARCHAR(64) NOT NULL COMMENT '姓名',
  role VARCHAR(32) NOT NULL COMMENT 'district/street/community/grid',
  org_code VARCHAR(32) NOT NULL COMMENT '组织编码（数据范围前缀）',
  org_level TINYINT NOT NULL COMMENT '1区 2街道 3社区 4网格',
  status TINYINT NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_username (username), KEY idx_org_code (org_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户与角色主数据';

DROP TABLE IF EXISTS sys_org;
CREATE TABLE sys_org (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_code VARCHAR(32) NOT NULL COMMENT '组织编码（层级前缀）',
  org_name VARCHAR(128) NOT NULL,
  org_level TINYINT NOT NULL,
  parent_code VARCHAR(32) NOT NULL DEFAULT '',
  level_name VARCHAR(32) NOT NULL,
  leader_id BIGINT NULL,
  min_lng DECIMAL(10,6) NULL, min_lat DECIMAL(10,6) NULL,
  max_lng DECIMAL(10,6) NULL, max_lat DECIMAL(10,6) NULL COMMENT '自绘地图边界',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_org_code (org_code), KEY idx_parent (parent_code), KEY idx_org_code (org_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='区/街道/社区/网格四级组织树';

DROP TABLE IF EXISTS sys_grid;
CREATE TABLE sys_grid (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  grid_code VARCHAR(32) NOT NULL COMMENT '网格编码（= 组织编码）',
  grid_name VARCHAR(128) NOT NULL,
  org_code VARCHAR(32) NOT NULL,
  parent_code VARCHAR(32) NOT NULL,
  street_code VARCHAR(32) NOT NULL,
  leader_id BIGINT NULL COMMENT '网格长（关联 sys_person）',
  worker_ids VARCHAR(255) NULL COMMENT '网格员ID列表（关联 sys_person）',
  party_member_count INT NOT NULL DEFAULT 0,
  population_count INT NOT NULL DEFAULT 0,
  qr_url VARCHAR(255) NULL COMMENT '便民码链接',
  lng DECIMAL(10,6) NULL, lat DECIMAL(10,6) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_grid_code (grid_code), KEY idx_org_code (org_code), KEY idx_street (street_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='网格台账';

DROP TABLE IF EXISTS sys_person;
CREATE TABLE sys_person (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_name VARCHAR(64) NOT NULL COMMENT '人员主数据：一处修改全局联动',
  phone VARCHAR(20) NULL,
  person_role VARCHAR(32) NOT NULL COMMENT '网格长/网格员/社区书记等',
  org_code VARCHAR(32) NOT NULL,
  grid_code VARCHAR(32) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_org_code (org_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='人员主数据';

DROP TABLE IF EXISTS sys_dict;
CREATE TABLE sys_dict (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dict_type VARCHAR(64) NOT NULL,
  dict_key VARCHAR(64) NOT NULL,
  dict_value VARCHAR(128) NOT NULL,
  sort_no INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id), KEY idx_type (dict_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='字典缓存';

DROP TABLE IF EXISTS biz_population;
CREATE TABLE biz_population (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_name VARCHAR(64) NOT NULL,
  idcard_cipher VARBINARY(256) NOT NULL COMMENT '身份证加密存储，展示层脱敏',
  phone_cipher VARBINARY(128) NULL,
  pop_type VARCHAR(32) NOT NULL COMMENT '户籍/常住/未落户/流动/境外/系统未分配',
  age INT NOT NULL, gender CHAR(1) NOT NULL,
  grid_code VARCHAR(32) NOT NULL,
  org_code VARCHAR(32) NOT NULL,
  special_tags VARCHAR(255) NULL COMMENT '九类特殊群体标签',
  address VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_grid (grid_code), KEY idx_type (pop_type), KEY idx_name (person_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实有人口（2万+）';

DROP TABLE IF EXISTS biz_house;
CREATE TABLE biz_house (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  house_code VARCHAR(64) NOT NULL,
  building_id BIGINT NOT NULL,
  unit_no INT NOT NULL, room_no VARCHAR(16) NOT NULL,
  area DECIMAL(8,2) NOT NULL,
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_house_code (house_code), KEY idx_org_code (org_code), KEY idx_building (building_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实有房屋（5万+）';

DROP TABLE IF EXISTS biz_building;
CREATE TABLE biz_building (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_name VARCHAR(128) NOT NULL,
  building_type VARCHAR(64) NOT NULL COMMENT '多层住宅/高层住宅/商住两用/商业楼宇/公共配套',
  purpose VARCHAR(32) NOT NULL COMMENT '居住/商务/其他',
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL, street_code VARCHAR(32) NOT NULL,
  lng DECIMAL(10,6) NULL, lat DECIMAL(10,6) NULL,
  floors INT NOT NULL, households INT NOT NULL, build_year INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '正常',
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_grid (grid_code), KEY idx_purpose (purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实有建筑';

DROP TABLE IF EXISTS biz_enterprise;
CREATE TABLE biz_enterprise (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enterprise_name VARCHAR(255) NOT NULL,
  credit_code VARCHAR(64) NOT NULL COMMENT '统一社会信用代码',
  industry_type VARCHAR(64) NOT NULL,
  address VARCHAR(255) NULL, legal_person VARCHAR(64) NULL, contact_cipher VARBINARY(128) NULL,
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '在营', register_date DATE NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_credit (credit_code), KEY idx_org_code (org_code), KEY idx_name (enterprise_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='实有企业';

DROP TABLE IF EXISTS biz_community;
CREATE TABLE biz_community (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_name VARCHAR(255) NOT NULL,
  subject_type VARCHAR(32) NOT NULL COMMENT '小区/物业公司/物管会/驻地单位',
  property_company VARCHAR(255) NULL,
  manager VARCHAR(64) NULL, phone VARCHAR(20) NULL, households INT NOT NULL DEFAULT 0,
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL, address VARCHAR(255) NULL,
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_type (subject_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小区与驻地单位';

DROP TABLE IF EXISTS biz_part;
CREATE TABLE biz_part (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  part_name VARCHAR(128) NOT NULL,
  part_type VARCHAR(32) NOT NULL COMMENT '摄像头/路灯/健身器材/宣传栏/垃圾桶/消防设施/井盖/其他',
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL,
  lng DECIMAL(10,6) NULL, lat DECIMAL(10,6) NULL,
  status VARCHAR(32) NOT NULL DEFAULT '正常', install_date DATE NULL,
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_type (part_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='八类部件';

DROP TABLE IF EXISTS party_org;
CREATE TABLE party_org (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  org_name VARCHAR(255) NOT NULL, org_level VARCHAR(32) NOT NULL COMMENT '党委/党工委/党总支/党支部',
  parent_id BIGINT NULL, org_code VARCHAR(32) NOT NULL,
  secretary VARCHAR(64) NULL, establish_date DATE NULL, member_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='四级党组织树';

DROP TABLE IF EXISTS party_member;
CREATE TABLE party_member (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_name VARCHAR(64) NOT NULL,
  idcard_cipher VARBINARY(256) NOT NULL, phone_cipher VARBINARY(128) NULL,
  gender CHAR(1) NULL, org_id BIGINT NOT NULL, org_code VARCHAR(32) NOT NULL,
  join_date DATE NULL, status VARCHAR(32) NOT NULL COMMENT '正式党员/预备党员/离退休党员',
  excellent TINYINT NOT NULL DEFAULT 0, education VARCHAR(32) NULL, volunteer_hours INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_org_id (org_id), KEY idx_name (member_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='党员';

DROP TABLE IF EXISTS party_honor;
CREATE TABLE party_honor (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id BIGINT NOT NULL, honor_title VARCHAR(128) NOT NULL, honor_level VARCHAR(32) NOT NULL,
  award_date DATE NULL, org_code VARCHAR(32) NOT NULL, remark VARCHAR(500) NULL,
  PRIMARY KEY (id), KEY idx_member (member_id), KEY idx_org_code (org_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='党员荣誉（一人多条）';

DROP TABLE IF EXISTS party_flow;
CREATE TABLE party_flow (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id BIGINT NOT NULL, direction VARCHAR(16) NOT NULL COMMENT '流入/流出',
  from_org VARCHAR(255) NULL, to_org VARCHAR(255) NULL, flow_date DATE NULL,
  status VARCHAR(32) NOT NULL, handler VARCHAR(64) NULL, org_code VARCHAR(32) NOT NULL,
  PRIMARY KEY (id), KEY idx_org_code (org_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='党员流动管理';

DROP TABLE IF EXISTS party_meeting;
CREATE TABLE party_meeting (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meeting_type VARCHAR(32) NOT NULL COMMENT '支部党员大会/支部委员会/党小组会/党课',
  org_id BIGINT NULL, org_code VARCHAR(32) NOT NULL, title VARCHAR(255) NOT NULL,
  meeting_date DATETIME NULL, place VARCHAR(128) NULL, host VARCHAR(64) NULL,
  attendees INT NOT NULL DEFAULT 0, content TEXT NULL,
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_type (meeting_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='三会一课台账';

DROP TABLE IF EXISTS party_learning;
CREATE TABLE party_learning (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL, category VARCHAR(64) NULL, publisher VARCHAR(128) NULL,
  publish_date DATE NULL, hours INT NOT NULL DEFAULT 0, attachments INT NOT NULL DEFAULT 0,
  content TEXT NULL, progress INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学习教育资料';

DROP TABLE IF EXISTS learning_progress;
CREATE TABLE learning_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id BIGINT NULL, member_name VARCHAR(64) NULL, learning_id BIGINT NULL,
  hours INT NOT NULL DEFAULT 0, progress INT NOT NULL DEFAULT 0,
  org_code VARCHAR(32) NOT NULL DEFAULT '', report_time DATETIME NULL,
  PRIMARY KEY (id), KEY idx_org_code (org_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='党员学习进度上报';

DROP TABLE IF EXISTS history_learning;
CREATE TABLE history_learning (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  period_name VARCHAR(128) NOT NULL COMMENT '五个历史时期',
  column_name VARCHAR(64) NOT NULL COMMENT '每时期八个二级栏目',
  title VARCHAR(255) NOT NULL, summary TEXT NULL, cover VARCHAR(128) NULL, views INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id), KEY idx_period (period_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='历史学习';

-- ------------------------- 增量表（13 张） -------------------------
DROP TABLE IF EXISTS msg_message;
CREATE TABLE msg_message (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  msg_type VARCHAR(32) NOT NULL COMMENT '公告/预警通知/办事进度',
  title VARCHAR(255) NOT NULL, content TEXT NULL,
  grid_code VARCHAR(32) NULL, org_code VARCHAR(32) NOT NULL,
  publish_time DATETIME NULL, read_count INT NOT NULL DEFAULT 0, status VARCHAR(32) NOT NULL DEFAULT '已发布',
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_type (msg_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消息中心与推送记录';

DROP TABLE IF EXISTS cfg_banner;
CREATE TABLE cfg_banner (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, title VARCHAR(128) NOT NULL,
  image VARCHAR(255) NULL, link VARCHAR(255) NULL, sort_no INT NOT NULL DEFAULT 0, status VARCHAR(16) NOT NULL DEFAULT '启用',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='居民端轮播图';

DROP TABLE IF EXISTS cfg_shortcut;
CREATE TABLE cfg_shortcut (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, title VARCHAR(64) NOT NULL,
  icon VARCHAR(64) NULL, link VARCHAR(255) NULL, sort_no INT NOT NULL DEFAULT 0, status VARCHAR(16) NOT NULL DEFAULT '启用',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='居民端快捷入口';

DROP TABLE IF EXISTS cfg_recommend;
CREATE TABLE cfg_recommend (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, title VARCHAR(128) NOT NULL,
  link VARCHAR(255) NULL, sort_no INT NOT NULL DEFAULT 0, status VARCHAR(16) NOT NULL DEFAULT '启用',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='居民端推荐位';

DROP TABLE IF EXISTS pub_content;
CREATE TABLE pub_content (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  content_type VARCHAR(32) NOT NULL COMMENT '社区新闻/政策法规/活动通知',
  title VARCHAR(255) NOT NULL, summary TEXT NULL, body TEXT NULL,
  publisher VARCHAR(64) NULL, org_code VARCHAR(32) NOT NULL,
  publish_time DATETIME NULL, views INT NOT NULL DEFAULT 0, status VARCHAR(32) NOT NULL DEFAULT '已发布',
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_type (content_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内容发布/信息管理';

DROP TABLE IF EXISTS svc_request;
CREATE TABLE svc_request (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_code VARCHAR(64) NOT NULL COMMENT '申请编号',
  applicant VARCHAR(64) NOT NULL, applicant_phone_cipher VARBINARY(128) NULL,
  item_name VARCHAR(128) NOT NULL COMMENT '办理事项',
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '待受理' COMMENT '待受理->办理中->已办结',
  submit_time DATETIME NULL, handler VARCHAR(64) NULL, opinion VARCHAR(500) NULL, content TEXT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_request_code (request_code), KEY idx_org_code (org_code), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='办事申请（状态机）';

DROP TABLE IF EXISTS gov_event;
CREATE TABLE gov_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_code VARCHAR(64) NOT NULL, event_type VARCHAR(64) NOT NULL, title VARCHAR(255) NOT NULL,
  reporter VARCHAR(64) NULL, reporter_phone_cipher VARBINARY(128) NULL, location VARCHAR(255) NULL,
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '待派发' COMMENT '待派发->已派发->处置中->已办结->已归档',
  report_time DATETIME NULL, dispatcher VARCHAR(64) NULL, handler VARCHAR(64) NULL,
  result VARCHAR(500) NULL, photos INT NOT NULL DEFAULT 0, description TEXT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_event_code (event_code), KEY idx_org_code (org_code), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='治理万家事件（状态机）';

DROP TABLE IF EXISTS iot_device;
CREATE TABLE iot_device (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_code VARCHAR(64) NOT NULL, device_name VARCHAR(128) NOT NULL,
  theme VARCHAR(32) NOT NULL COMMENT '环境感知/安全感知/健康监测/智能停车/居民生活',
  device_type VARCHAR(64) NOT NULL, grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL,
  location VARCHAR(255) NULL, lng DECIMAL(10,6) NULL, lat DECIMAL(10,6) NULL,
  status VARCHAR(16) NOT NULL DEFAULT '在线', last_heartbeat DATETIME NULL,
  last_value INT NULL, install_date DATE NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_device_code (device_code), KEY idx_org_code (org_code), KEY idx_theme (theme)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='感知设备台账';

DROP TABLE IF EXISTS iot_alarm;
CREATE TABLE iot_alarm (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  alarm_code VARCHAR(64) NOT NULL, device_id BIGINT NOT NULL, theme VARCHAR(32) NOT NULL,
  alarm_type VARCHAR(128) NOT NULL, location VARCHAR(255) NULL,
  grid_code VARCHAR(32) NOT NULL, org_code VARCHAR(32) NOT NULL,
  alarm_time DATETIME NULL, alarm_level VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '待处置' COMMENT '待处置->处置中->已处置->已归档',
  snapshot_url VARCHAR(255) NULL COMMENT '现场抓拍图',
  handler VARCHAR(64) NULL, handle_time DATETIME NULL, result VARCHAR(500) NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_alarm_code (alarm_code), KEY idx_org_code (org_code), KEY idx_device (device_id), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='告警（状态机）';

DROP TABLE IF EXISTS iot_work_order;
CREATE TABLE iot_work_order (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_code VARCHAR(64) NOT NULL, alarm_id BIGINT NULL, device_id BIGINT NULL,
  title VARCHAR(255) NOT NULL, assignee VARCHAR(64) NULL,
  org_code VARCHAR(32) NOT NULL, grid_code VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '待接单', create_time DATETIME NULL, finish_time DATETIME NULL, remark VARCHAR(500) NULL,
  PRIMARY KEY (id), KEY idx_org_code (org_code), KEY idx_alarm (alarm_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='处置工单';

DROP TABLE IF EXISTS biz_contract;
CREATE TABLE biz_contract (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_code VARCHAR(64) NOT NULL, party VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL COMMENT '签约/试用/到期预警/终止',
  amount DECIMAL(14,2) NOT NULL, start_date DATE NULL, end_date DATE NULL,
  module_count INT NOT NULL DEFAULT 0, contact VARCHAR(64) NULL, phone VARCHAR(20) NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_contract_code (contract_code), KEY idx_status (status), KEY idx_end_date (end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订阅合同';

DROP TABLE IF EXISTS biz_flow_log;
CREATE TABLE biz_flow_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_type VARCHAR(32) NOT NULL COMMENT '办事/治理万家/告警',
  biz_id VARCHAR(64) NOT NULL, from_status VARCHAR(32) NULL, to_status VARCHAR(32) NOT NULL,
  operator VARCHAR(64) NOT NULL, operate_time DATETIME NOT NULL, remark VARCHAR(500) NULL,
  PRIMARY KEY (id), KEY idx_biz (biz_type, biz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='状态流转记录（全程留痕）';

DROP TABLE IF EXISTS sys_op_log;
CREATE TABLE sys_op_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NULL, real_name VARCHAR(64) NULL, org_code VARCHAR(32) NULL,
  action VARCHAR(64) NOT NULL COMMENT '登录/导出/查看明文/导入/状态流转/删除等',
  detail VARCHAR(500) NULL, operate_time DATETIME NOT NULL,
  PRIMARY KEY (id), KEY idx_time (operate_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='敏感操作审计日志';

SET FOREIGN_KEY_CHECKS = 1;
-- 说明：Oracle/MySQL 5.7 下 utf8mb4 索引字段长度已控制在 767 字节以内；
-- 生产环境请为 idcard_cipher / phone_cipher 配置应用级加密密钥，并按需补充 ES 索引同步。
