IF DB_ID('GitHubActivity') IS NULL
BEGIN
    CREATE DATABASE GitHubActivity;
END;
GO

DECLARE @syncPassword nvarchar(128) = N'$(GITHUB_SYNC_PASSWORD)';
DECLARE @readPassword nvarchar(128) = N'$(GITHUB_READ_PASSWORD)';
DECLARE @statement nvarchar(max);

IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'dab_github_sync')
    SET @statement = N'ALTER LOGIN [dab_github_sync] WITH PASSWORD = '
        + QUOTENAME(@syncPassword, '''') + N';';
ELSE
    SET @statement = N'CREATE LOGIN [dab_github_sync] WITH PASSWORD = '
        + QUOTENAME(@syncPassword, '''') + N', CHECK_POLICY = ON;';
EXEC (@statement);

IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'dab_github_read')
    SET @statement = N'ALTER LOGIN [dab_github_read] WITH PASSWORD = '
        + QUOTENAME(@readPassword, '''') + N';';
ELSE
    SET @statement = N'CREATE LOGIN [dab_github_read] WITH PASSWORD = '
        + QUOTENAME(@readPassword, '''') + N', CHECK_POLICY = ON;';
EXEC (@statement);
GO

USE GitHubActivity;
GO

IF OBJECT_ID('dbo.GitHubThreads') IS NULL
BEGIN
    CREATE TABLE dbo.GitHubThreads
    (
        id nvarchar(64) NOT NULL CONSTRAINT PK_GitHubThreads PRIMARY KEY,
        repository nvarchar(260) NOT NULL,
        number int NOT NULL,
        itemType nvarchar(20) NOT NULL,
        title nvarchar(500) NOT NULL,
        url nvarchar(1000) NOT NULL,
        participation nvarchar(100) NOT NULL,
        author nvarchar(100) NULL,
        createdAt datetime2 NOT NULL,
        updatedAt datetime2 NOT NULL,
        isOpen bit NOT NULL,
        lastSyncedAt datetime2 NOT NULL
    );
    CREATE UNIQUE INDEX UX_GitHubThreads_Repository_Number
        ON dbo.GitHubThreads(repository, number);
END;
GO

IF OBJECT_ID('dbo.GitHubTimelineEvents') IS NULL
BEGIN
    CREATE TABLE dbo.GitHubTimelineEvents
    (
        id nvarchar(100) NOT NULL CONSTRAINT PK_GitHubTimelineEvents PRIMARY KEY,
        threadId nvarchar(64) NOT NULL,
        eventType nvarchar(40) NOT NULL,
        actor nvarchar(100) NULL,
        summary nvarchar(2000) NOT NULL,
        url nvarchar(1000) NOT NULL,
        occurredAt datetime2 NOT NULL,
        CONSTRAINT FK_GitHubTimelineEvents_Threads
            FOREIGN KEY (threadId) REFERENCES dbo.GitHubThreads(id)
    );
    CREATE INDEX IX_GitHubTimelineEvents_OccurredAt
        ON dbo.GitHubTimelineEvents(occurredAt DESC, id DESC);
END;
GO

IF OBJECT_ID('dbo.GitHubSyncState') IS NULL
BEGIN
    CREATE TABLE dbo.GitHubSyncState
    (
        id nvarchar(32) NOT NULL CONSTRAINT PK_GitHubSyncState PRIMARY KEY,
        lastAttemptAt datetime2 NOT NULL,
        lastSuccessAt datetime2 NULL,
        lastError nvarchar(2000) NULL,
        threadCount int NOT NULL,
        eventCount int NOT NULL
    );
END;
GO

CREATE OR ALTER VIEW dbo.OpenContributions
AS
    SELECT
        id,
        repository,
        number,
        itemType,
        title,
        url,
        participation,
        CAST(CASE WHEN CHARINDEX('authored', participation) > 0 THEN 1 ELSE 0 END AS bit)
            AS isAuthored,
        CAST(CASE WHEN CHARINDEX('commented', participation) > 0
            OR CHARINDEX('reviewed', participation) > 0 THEN 1 ELSE 0 END AS bit)
            AS isCommented,
        author,
        createdAt,
        updatedAt
    FROM dbo.GitHubThreads
    WHERE isOpen = 1;
GO

CREATE OR ALTER VIEW dbo.ContributionTimeline
AS
    SELECT
        event.id AS eventId,
        thread.id AS threadId,
        thread.repository,
        thread.number,
        thread.itemType,
        thread.title,
        thread.url AS threadUrl,
        thread.participation,
        CAST(CASE WHEN CHARINDEX('authored', thread.participation) > 0 THEN 1 ELSE 0 END AS bit)
            AS isAuthored,
        CAST(CASE WHEN CHARINDEX('commented', thread.participation) > 0
            OR CHARINDEX('reviewed', thread.participation) > 0 THEN 1 ELSE 0 END AS bit)
            AS isCommented,
        event.eventType,
        event.actor,
        event.summary,
        event.url AS eventUrl,
        event.occurredAt
    FROM dbo.GitHubTimelineEvents AS event
    INNER JOIN dbo.GitHubThreads AS thread ON thread.id = event.threadId
    WHERE thread.isOpen = 1;
GO

IF USER_ID('dab_github_sync') IS NULL
    CREATE USER [dab_github_sync] FOR LOGIN [dab_github_sync];
IF USER_ID('dab_github_read') IS NULL
    CREATE USER [dab_github_read] FOR LOGIN [dab_github_read];
GO

GRANT SELECT, INSERT, UPDATE ON dbo.GitHubThreads TO [dab_github_sync];
GRANT SELECT, INSERT, UPDATE ON dbo.GitHubTimelineEvents TO [dab_github_sync];
GRANT SELECT, INSERT, UPDATE ON dbo.GitHubSyncState TO [dab_github_sync];
GRANT VIEW DEFINITION ON dbo.GitHubThreads TO [dab_github_sync];
GRANT VIEW DEFINITION ON dbo.GitHubTimelineEvents TO [dab_github_sync];
GRANT VIEW DEFINITION ON dbo.GitHubSyncState TO [dab_github_sync];

GRANT SELECT ON dbo.OpenContributions TO [dab_github_read];
GRANT SELECT ON dbo.ContributionTimeline TO [dab_github_read];
GRANT SELECT ON dbo.GitHubSyncState TO [dab_github_read];
GRANT VIEW DEFINITION ON dbo.OpenContributions TO [dab_github_read];
GRANT VIEW DEFINITION ON dbo.ContributionTimeline TO [dab_github_read];
GRANT VIEW DEFINITION ON dbo.GitHubSyncState TO [dab_github_read];
GO
