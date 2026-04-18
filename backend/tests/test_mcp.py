"""Tests for the Squill MCP server tools.

Uses FastMCP's direct call_tool() for testing tool logic against a real
(test) database. This tests the actual tool functions end-to-end without
needing the MCP protocol transport layer.
"""

import json

import pytest
from sqlalchemy import select

from database import get_session_maker
from models import Base, Box, Canvas, User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def setup_db():
    """Create tables before each test and drop after."""
    from database import get_engine

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db():
    session_maker = get_session_maker()
    async with session_maker() as session:
        yield session


@pytest.fixture
async def test_user(db):
    """Create a test user matching MCP_USER_ID in mock settings."""
    user = User(id="test-user-id", email="test@example.com", plan="pro", is_vip=True)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
async def test_canvas(db, test_user):
    """Create a test canvas."""
    canvas = Canvas(id="canvas-1", user_id=test_user.id, name="Test Canvas")
    db.add(canvas)
    await db.commit()
    await db.refresh(canvas)
    return canvas


@pytest.fixture
async def test_boxes(db, test_canvas):
    """Create test boxes on the canvas."""
    boxes = [
        Box(
            canvas_id=test_canvas.id,
            box_id=1,
            state={
                "type": "sql",
                "query": "SELECT 1",
                "name": "query_1",
                "x": 0,
                "y": 0,
                "width": 600,
                "height": 500,
                "zIndex": 1,
                "dependencies": [],
            },
        ),
        Box(
            canvas_id=test_canvas.id,
            box_id=2,
            state={
                "type": "note",
                "query": "Hello world",
                "name": "note_1",
                "x": 700,
                "y": 0,
                "width": 400,
                "height": 300,
                "zIndex": 2,
                "dependencies": [],
            },
        ),
    ]
    for b in boxes:
        db.add(b)
    test_canvas.next_box_id = 3
    await db.commit()
    return boxes


@pytest.fixture
def mcp():
    """Get the FastMCP server instance."""
    from mcp_server import mcp

    return mcp


# ---------------------------------------------------------------------------
# Tool discovery
# ---------------------------------------------------------------------------


async def test_list_tools(mcp):
    """All expected tools are registered."""
    tools = await mcp.list_tools()
    names = {t.name for t in tools}
    expected = {
        "list_canvases",
        "get_canvas",
        "create_box",
        "update_box",
        "delete_box",
        "execute_query",
        "list_connections",
    }
    assert expected <= names, f"Missing tools: {expected - names}"


# ---------------------------------------------------------------------------
# Canvas tools
# ---------------------------------------------------------------------------


async def test_list_canvases(mcp, test_user, test_canvas):
    """list_canvases returns the user's canvases."""
    content, _ = await mcp.call_tool("list_canvases", {})
    data = json.loads(content[0].text)
    assert len(data) == 1
    assert data[0]["id"] == "canvas-1"
    assert data[0]["name"] == "Test Canvas"


async def test_list_canvases_empty(mcp, test_user):
    """list_canvases returns empty list when user has no canvases."""
    content, _ = await mcp.call_tool("list_canvases", {})
    data = json.loads(content[0].text)
    assert data == []


async def test_get_canvas(mcp, test_user, test_canvas, test_boxes):
    """get_canvas returns canvas with all boxes."""
    content, _ = await mcp.call_tool("get_canvas", {"canvas_id": "canvas-1"})
    data = json.loads(content[0].text)
    assert data["name"] == "Test Canvas"
    assert len(data["boxes"]) == 2
    assert data["boxes"][0]["state"]["query"] == "SELECT 1"
    assert data["boxes"][1]["state"]["type"] == "note"


async def test_get_canvas_not_found(mcp, test_user):
    """get_canvas returns error for non-existent canvas."""
    content, _ = await mcp.call_tool("get_canvas", {"canvas_id": "nonexistent"})
    data = json.loads(content[0].text)
    assert "error" in data


# ---------------------------------------------------------------------------
# Box CRUD
# ---------------------------------------------------------------------------


async def test_create_box(mcp, test_user, test_canvas, db):
    """create_box adds a box and increments next_box_id."""
    content, _ = await mcp.call_tool(
        "create_box",
        {
            "canvas_id": "canvas-1",
            "box_type": "sql",
            "query": "SELECT * FROM users",
            "name": "users_query",
            "x": 200,
            "y": 300,
        },
    )
    data = json.loads(content[0].text)
    assert data["box_id"] == 1
    assert data["state"]["query"] == "SELECT * FROM users"
    assert data["state"]["name"] == "users_query"

    # Verify in database
    db.expire_all()
    box_result = await db.execute(
        select(Box).where(Box.canvas_id == "canvas-1", Box.box_id == 1)
    )
    box = box_result.scalar_one()
    assert box.state["query"] == "SELECT * FROM users"


async def test_create_multiple_boxes(mcp, test_user, test_canvas, db):
    """create_box assigns sequential IDs."""
    await mcp.call_tool("create_box", {"canvas_id": "canvas-1", "box_type": "sql"})
    await mcp.call_tool("create_box", {"canvas_id": "canvas-1", "box_type": "note"})
    content, _ = await mcp.call_tool(
        "create_box", {"canvas_id": "canvas-1", "box_type": "sql"}
    )
    data = json.loads(content[0].text)
    assert data["box_id"] == 3  # third box


async def test_update_box(mcp, test_user, test_canvas, test_boxes):
    """update_box merges fields into existing state."""
    content, _ = await mcp.call_tool(
        "update_box",
        {
            "canvas_id": "canvas-1",
            "box_id": 1,
            "query": "SELECT 2",
            "name": "updated_query",
        },
    )
    data = json.loads(content[0].text)
    assert data["state"]["query"] == "SELECT 2"
    assert data["state"]["name"] == "updated_query"
    # Original fields preserved
    assert data["state"]["type"] == "sql"
    assert data["state"]["x"] == 0


async def test_update_box_partial(mcp, test_user, test_canvas, test_boxes):
    """update_box only changes specified fields."""
    content, _ = await mcp.call_tool(
        "update_box",
        {"canvas_id": "canvas-1", "box_id": 1, "x": 500},
    )
    data = json.loads(content[0].text)
    assert data["state"]["x"] == 500
    assert data["state"]["query"] == "SELECT 1"  # unchanged


async def test_update_box_not_found(mcp, test_user, test_canvas):
    """update_box returns error for non-existent box."""
    content, _ = await mcp.call_tool(
        "update_box",
        {"canvas_id": "canvas-1", "box_id": 999, "query": "SELECT 1"},
    )
    data = json.loads(content[0].text)
    assert "error" in data


async def test_delete_box(mcp, test_user, test_canvas, test_boxes, db):
    """delete_box removes the box."""
    content, _ = await mcp.call_tool(
        "delete_box",
        {"canvas_id": "canvas-1", "box_id": 1},
    )
    data = json.loads(content[0].text)
    assert data["deleted"] is True

    # Verify removed from database
    db.expire_all()
    box_result = await db.execute(
        select(Box).where(Box.canvas_id == "canvas-1", Box.box_id == 1)
    )
    assert box_result.scalar_one_or_none() is None


async def test_delete_box_not_found(mcp, test_user, test_canvas):
    """delete_box returns error for non-existent box."""
    content, _ = await mcp.call_tool(
        "delete_box",
        {"canvas_id": "canvas-1", "box_id": 999},
    )
    data = json.loads(content[0].text)
    assert "error" in data


async def test_canvas_version_increments(mcp, test_user, test_canvas, test_boxes, db):
    """Each mutation increments the canvas version."""
    db.expire_all()
    canvas = (
        await db.execute(select(Canvas).where(Canvas.id == "canvas-1"))
    ).scalar_one()
    initial_version = canvas.version

    await mcp.call_tool("create_box", {"canvas_id": "canvas-1", "box_type": "sql"})
    db.expire_all()
    canvas = (
        await db.execute(select(Canvas).where(Canvas.id == "canvas-1"))
    ).scalar_one()
    assert canvas.version == initial_version + 1

    await mcp.call_tool(
        "update_box", {"canvas_id": "canvas-1", "box_id": 1, "query": "new"}
    )
    db.expire_all()
    canvas = (
        await db.execute(select(Canvas).where(Canvas.id == "canvas-1"))
    ).scalar_one()
    assert canvas.version == initial_version + 2

    await mcp.call_tool("delete_box", {"canvas_id": "canvas-1", "box_id": 1})
    db.expire_all()
    canvas = (
        await db.execute(select(Canvas).where(Canvas.id == "canvas-1"))
    ).scalar_one()
    assert canvas.version == initial_version + 3
