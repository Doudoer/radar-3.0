REVOKE ALL PRIVILEGES ON `radar\_v3`.* FROM 'radar_local'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `radar\_v3`.* TO 'radar_local'@'%';
