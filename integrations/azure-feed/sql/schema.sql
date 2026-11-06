-- SQL Server 2022 and Azure SQL Database. Apply as a database owner, not the reader identity.
IF OBJECT_ID(N'dbo.PublicDemoFeed', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.PublicDemoFeed (
    id varchar(16) NOT NULL CONSTRAINT PK_PublicDemoFeed PRIMARY KEY,
    document nvarchar(max) NOT NULL,
    publishedAt datetime2(3) NOT NULL CONSTRAINT DF_PublicDemoFeed_publishedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_PublicDemoFeed_id CHECK (id = 'today'),
    CONSTRAINT CK_PublicDemoFeed_json CHECK (ISJSON(document) = 1),
    -- ISNULL prevents SQL's unknown/NULL CHECK semantics from accepting missing flags.
    CONSTRAINT CK_PublicDemoFeed_public CHECK (
      ISNULL(JSON_VALUE(document, '$.fictional'), '') = 'true'
      AND ISNULL(JSON_VALUE(document, '$.schemaVersion'), '') = '1'
    )
  );
END;
GO
